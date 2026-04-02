/**
 * permission-delegation.test.ts
 * Phase 21: Unit tests for permissionDelegationService
 *
 * Uses queue-based mock DB — no real database required.
 * Tests cover:
 *   - checkPermission: pre-approved / denied / needs_escalation paths
 *   - toolNameToPermissionType: tool name → PermissionType mapping
 *   - requestPermission: DB insert + message bus notification
 *   - resolvePermission: status update + worker notification
 *   - listPendingForSession: pending request listing
 *   - cleanupExpired: TTL-based expiry
 *   - buildPendingPermissionsContext: context string generation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  permissionDelegationService,
} from "./permission-delegation.js";
import {
  toolNameToPermissionType,
  resolveWorkerPermissionProfile,
} from "./agent-permissions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePermissionRequest(overrides: Partial<{
  id: string;
  companyId: string;
  coordinatorSessionId: string;
  workerAgentId: string;
  toolName: string;
  permissionType: string;
  description: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
}> = {}) {
  return {
    id: "perm-1",
    companyId: "co-1",
    coordinatorSessionId: "session-1",
    workerAgentId: "worker-1",
    resolverAgentId: null,
    resolverUserId: null,
    toolName: "Bash",
    permissionType: "bash_execute",
    description: "Run tests",
    toolInput: {},
    status: "pending",
    grantScope: null,
    feedback: null,
    updatedInput: null,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Queue-based mock DB.
 * Inserts and updates capture their arguments for assertions.
 */
function makeMockDb(opts: {
  flagEnabled?: boolean;
  insertReturns?: unknown[];
  updateReturns?: unknown[];
  selectRows?: unknown[];
} = {}) {
  const flagEnabled = opts.flagEnabled ?? true;
  const insertReturns = opts.insertReturns ?? [makePermissionRequest()];
  const updateReturns = opts.updateReturns ?? [makePermissionRequest({ status: "approved" })];
  const selectRows = opts.selectRows ?? [makePermissionRequest()];

  const insertedValues: unknown[] = [];
  const updatedValues: unknown[] = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() =>
          Promise.resolve(
            flagEnabled
              ? [{ experimental: { featureFlags: { permission_delegation: true, message_bus: true } } }]
              : [{ experimental: { featureFlags: {} } }],
          ),
        ),
      })),
    })),

    insert: vi.fn((_table: unknown) => ({
      values: vi.fn((vals: unknown) => {
        insertedValues.push(vals);
        return {
          returning: vi.fn(() => Promise.resolve(insertReturns)),
        };
      }),
    })),

    update: vi.fn((_table: unknown) => ({
      set: vi.fn((vals: unknown) => {
        updatedValues.push(vals);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve(updateReturns)),
          })),
        };
      }),
    })),

    _insertedValues: insertedValues,
    _updatedValues: updatedValues,
  } as unknown as import("@paperclipai/db").Db & {
    _insertedValues: unknown[];
    _updatedValues: unknown[];
  };

  return db;
}

// ---------------------------------------------------------------------------
// toolNameToPermissionType
// ---------------------------------------------------------------------------

describe("toolNameToPermissionType", () => {
  it("maps Bash to bash_execute", () => {
    expect(toolNameToPermissionType("Bash")).toBe("bash_execute");
    expect(toolNameToPermissionType("bash")).toBe("bash_execute");
    expect(toolNameToPermissionType("execute")).toBe("bash_execute");
  });

  it("maps Write / WriteFile to file_write", () => {
    expect(toolNameToPermissionType("Write")).toBe("file_write");
    expect(toolNameToPermissionType("writefile")).toBe("file_write");
  });

  it("maps Delete / Remove to file_delete", () => {
    expect(toolNameToPermissionType("Delete")).toBe("file_delete");
    expect(toolNameToPermissionType("remove")).toBe("file_delete");
  });

  it("maps git push tools to git_push", () => {
    expect(toolNameToPermissionType("gitpush")).toBe("git_push");
    expect(toolNameToPermissionType("git_push")).toBe("git_push");
  });

  it("maps network tools to network_access", () => {
    expect(toolNameToPermissionType("fetch")).toBe("network_access");
    expect(toolNameToPermissionType("WebFetch")).toBe("network_access");
    expect(toolNameToPermissionType("WebSearch")).toBe("network_access");
  });

  it("maps MCP tools to mcp_tool_use", () => {
    expect(toolNameToPermissionType("mcp.github:list-prs")).toBe("mcp_tool_use");
    expect(toolNameToPermissionType("mcp_run_query")).toBe("mcp_tool_use");
  });

  it("returns null for Read / Glob / Grep (non-destructive tools)", () => {
    expect(toolNameToPermissionType("Read")).toBeNull();
    expect(toolNameToPermissionType("Glob")).toBeNull();
    expect(toolNameToPermissionType("Grep")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveWorkerPermissionProfile
// ---------------------------------------------------------------------------

describe("resolveWorkerPermissionProfile", () => {
  it("returns defaults when runtimeConfig is null", () => {
    const profile = resolveWorkerPermissionProfile(null);
    expect(profile.preApproved).toEqual([]);
    expect(profile.denied).toEqual([]);
  });

  it("returns defaults when no permissionProfile key", () => {
    const profile = resolveWorkerPermissionProfile({ someOtherKey: true });
    expect(profile.preApproved).toEqual([]);
  });

  it("parses preApproved and denied from runtimeConfig", () => {
    const profile = resolveWorkerPermissionProfile({
      permissionProfile: {
        preApproved: ["file_write", "network_access"],
        denied: ["file_delete"],
      },
    });
    expect(profile.preApproved).toEqual(["file_write", "network_access"]);
    expect(profile.denied).toEqual(["file_delete"]);
  });

  it("ignores non-string entries in arrays", () => {
    const profile = resolveWorkerPermissionProfile({
      permissionProfile: {
        preApproved: ["file_write", 42, null, "bash_execute"],
        denied: [],
      },
    });
    expect(profile.preApproved).toEqual(["file_write", "bash_execute"]);
  });
});

// ---------------------------------------------------------------------------
// checkPermission
// ---------------------------------------------------------------------------

describe("checkPermission", () => {
  const db = makeMockDb();
  const svc = permissionDelegationService(db);

  it("returns 'allowed' for non-controlled tool (Read)", () => {
    const result = svc.checkPermission({
      companyId: "co-1",
      workerAgentId: "worker-1",
      toolName: "Read",
    });
    expect(result).toBe("allowed");
  });

  it("returns 'needs_escalation' for Bash by default", () => {
    const result = svc.checkPermission({
      companyId: "co-1",
      workerAgentId: "worker-1",
      toolName: "Bash",
    });
    expect(result).toBe("needs_escalation");
  });

  it("returns 'allowed' when tool is pre-approved in profile", () => {
    const result = svc.checkPermission({
      companyId: "co-1",
      workerAgentId: "worker-1",
      toolName: "Bash",
      agentRuntimeConfig: {
        permissionProfile: { preApproved: ["bash_execute"], denied: [] },
      },
    });
    expect(result).toBe("allowed");
  });

  it("returns 'denied' when tool is in denied list", () => {
    const result = svc.checkPermission({
      companyId: "co-1",
      workerAgentId: "worker-1",
      toolName: "Delete",
      agentRuntimeConfig: {
        permissionProfile: { preApproved: [], denied: ["file_delete"] },
      },
    });
    expect(result).toBe("denied");
  });

  it("returns 'allowed' when tool type is in sessionGrants", () => {
    const sessionGrants = new Set<import("@paperclipai/shared").PermissionType>(["bash_execute"]);
    const result = svc.checkPermission({
      companyId: "co-1",
      workerAgentId: "worker-1",
      toolName: "Bash",
      sessionGrants,
    });
    expect(result).toBe("allowed");
  });
});

// ---------------------------------------------------------------------------
// requestPermission
// ---------------------------------------------------------------------------

describe("requestPermission", () => {
  it("inserts a permission request and returns the record", async () => {
    const db = makeMockDb();
    const svc = permissionDelegationService(db);

    const req = await svc.requestPermission({
      companyId: "co-1",
      coordinatorSessionId: "session-1",
      workerAgentId: "worker-1",
      coordinatorAgentId: "coord-1",
      toolName: "Bash",
      permissionType: "bash_execute",
      description: "Run test suite",
    });

    expect(req.id).toBe("perm-1");
    expect(req.status).toBe("pending");
    expect(db.insert).toHaveBeenCalled();
  });

  it("sets expiresAt based on ttlSeconds", async () => {
    const db = makeMockDb();
    const svc = permissionDelegationService(db);

    const before = Date.now();
    await svc.requestPermission({
      companyId: "co-1",
      coordinatorSessionId: "session-1",
      workerAgentId: "worker-1",
      coordinatorAgentId: "coord-1",
      toolName: "Bash",
      permissionType: "bash_execute",
      description: "Run deploy",
      ttlSeconds: 60,
    });

    const inserted = (db as any)._insertedValues[0] as { expiresAt: Date };
    const expiresMs = inserted.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 60_000);
    expect(expiresMs).toBeLessThan(before + 61_000 + 100); // allow 100ms slack
  });
});

// ---------------------------------------------------------------------------
// resolvePermission
// ---------------------------------------------------------------------------

describe("resolvePermission", () => {
  it("updates status to approved and returns the record", async () => {
    const db = makeMockDb();
    const svc = permissionDelegationService(db);

    const resolved = await svc.resolvePermission(
      "perm-1",
      { decision: "approved", grantScope: "session" },
      { agentId: "coord-1" },
    );

    expect(resolved.status).toBe("approved");
    expect(db.update).toHaveBeenCalled();
  });

  it("updates status to rejected with feedback", async () => {
    const db = makeMockDb({
      updateReturns: [makePermissionRequest({ status: "rejected" })],
    });
    const svc = permissionDelegationService(db);

    const resolved = await svc.resolvePermission(
      "perm-1",
      { decision: "rejected", feedback: "Too dangerous" },
      { userId: "user-1" },
    );

    expect(resolved.status).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// listPendingForSession
// ---------------------------------------------------------------------------

describe("listPendingForSession", () => {
  it("returns pending requests for a session", async () => {
    const pending = [makePermissionRequest(), makePermissionRequest({ id: "perm-2" })];
    const db = makeMockDb({ selectRows: pending });

    // Override select to return pending list
    (db.select as any) = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(pending)),
      })),
    }));

    const svc = permissionDelegationService(db);
    const result = await svc.listPendingForSession("co-1", "session-1");

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("perm-1");
  });
});

// ---------------------------------------------------------------------------
// cleanupExpired
// ---------------------------------------------------------------------------

describe("cleanupExpired", () => {
  it("updates expired pending requests and returns count", async () => {
    const db = makeMockDb({
      updateReturns: [
        makePermissionRequest({ id: "perm-old-1" }),
        makePermissionRequest({ id: "perm-old-2" }),
      ],
    });
    const svc = permissionDelegationService(db);

    const count = await svc.cleanupExpired("co-1");
    expect(count).toBe(2);
    expect(db.update).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildPendingPermissionsContext
// ---------------------------------------------------------------------------

describe("buildPendingPermissionsContext", () => {
  const db = makeMockDb();
  const svc = permissionDelegationService(db);

  it("returns empty string when no pending requests", () => {
    const ctx = svc.buildPendingPermissionsContext([]);
    expect(ctx).toBe("");
  });

  it("includes request details in context block", () => {
    const reqs = [makePermissionRequest()];
    const ctx = svc.buildPendingPermissionsContext(reqs as any);
    expect(ctx).toContain("<pending-permission-requests>");
    expect(ctx).toContain("perm-1");
    expect(ctx).toContain("bash_execute");
    expect(ctx).toContain("</pending-permission-requests>");
  });
});
