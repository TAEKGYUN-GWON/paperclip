/**
 * auto-claim.test.ts
 * Phase 11: Unit tests for autoClaimService
 *
 * Uses queue-based mock DB — no real database required.
 * Tests cover:
 *   - isEnabled: flag-gated detection
 *   - getPolicy: default and custom policy loading
 *   - findNextCandidate: priority ordering, blocked issue filtering
 *   - claimIssue: optimistic lock success/failure
 *   - tryAutoClaim: full flow including limit enforcement and race conditions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { autoClaimService } from "./auto-claim.js";
import type { AutoClaimPolicy } from "./auto-claim.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<{
  id: string;
  companyId: string;
  status: string;
  priority: string;
  projectId: string | null;
  assigneeAgentId: string | null;
  createdAt: Date;
}> = {}) {
  return {
    id: "issue-1",
    companyId: "co-1",
    status: "todo",
    priority: "medium",
    projectId: "proj-1",
    assigneeAgentId: null,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Queue-based mock DB.
 * Each select().from().where() call pops the next pre-loaded row set.
 * .where() returns a thenable AND supports .limit()/.returning() chaining.
 */
function makeMockDb(opts: { flagEnabled?: boolean } = {}) {
  const flagEnabled = opts.flagEnabled ?? true;
  const rowQueue: unknown[][] = [];
  let lastUpdateWhere: unknown = null;
  let updateReturnEmpty = false;

  function pushRows(...sets: unknown[][]) {
    for (const set of sets) rowQueue.push(set);
  }

  function nextRows(): unknown[] {
    const next = rowQueue.shift();
    if (next !== undefined) return next;
    // Default: flag row
    return [
      {
        experimental: {
          featureFlags: { auto_claim: flagEnabled },
        },
      },
    ];
  }

  const db = {
    select: vi.fn((_fields?: unknown) => ({
      from: vi.fn((_table: unknown) => ({
        where: vi.fn((_cond: unknown) => {
          let resolved: unknown[] | null = null;
          const getResult = () => {
            if (resolved === null) resolved = nextRows();
            return resolved;
          };
          return {
            then: (onFulfilled: any, onRejected?: any) =>
              Promise.resolve(getResult()).then(onFulfilled, onRejected),
            limit: vi.fn((_n: number) => Promise.resolve(getResult())),
          };
        }),
      })),
    })),

    update: vi.fn((_table: unknown) => ({
      set: vi.fn((_values: unknown) => ({
        where: vi.fn((cond: unknown) => {
          lastUpdateWhere = cond;
          return {
            returning: vi.fn((_fields?: unknown) => {
              if (updateReturnEmpty) return Promise.resolve([]);
              return Promise.resolve([{ id: "issue-1" }]);
            }),
          };
        }),
      })),
    })),
  };

  return {
    db: db as any,
    pushRows,
    getLastUpdateWhere: () => lastUpdateWhere,
    setUpdateReturnEmpty: (val: boolean) => { updateReturnEmpty = val; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("autoClaimService", () => {
  describe("isEnabled", () => {
    it("returns false when flag is disabled", async () => {
      const { db, pushRows } = makeMockDb({ flagEnabled: false });
      pushRows([
        { experimental: { featureFlags: { auto_claim: false } } },
      ]);

      const svc = autoClaimService(db);
      expect(await svc.isEnabled()).toBe(false);
    });

    it("returns true when flag is enabled", async () => {
      const { db, pushRows } = makeMockDb({ flagEnabled: true });
      pushRows([
        { experimental: { featureFlags: { auto_claim: true } } },
      ]);

      const svc = autoClaimService(db);
      expect(await svc.isEnabled()).toBe(true);
    });
  });

  describe("getPolicy", () => {
    it("returns default policy when agent has no runtimeConfig.autoClaim", async () => {
      const { db, pushRows } = makeMockDb();
      // Agent row with empty runtimeConfig
      pushRows([{ runtimeConfig: {} }]);

      const svc = autoClaimService(db);
      const policy = await svc.getPolicy("co-1", "agent-1");

      expect(policy.maxConcurrentClaims).toBe(1);
      expect(policy.claimableStatuses).toEqual(["backlog", "todo"]);
      expect(policy.priorityOrder).toBe("priority_first");
      expect(policy.projectScope).toBeNull();
      expect(policy.respectDependencies).toBe(true);
    });

    it("returns merged policy from agent runtimeConfig", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([{
        runtimeConfig: {
          autoClaim: {
            maxConcurrentClaims: 3,
            priorityOrder: "created_first",
            projectScope: "proj-x",
            respectDependencies: false,
          },
        },
      }]);

      const svc = autoClaimService(db);
      const policy = await svc.getPolicy("co-1", "agent-1");

      expect(policy.maxConcurrentClaims).toBe(3);
      expect(policy.priorityOrder).toBe("created_first");
      expect(policy.projectScope).toBe("proj-x");
      expect(policy.respectDependencies).toBe(false);
    });

    it("returns default policy when agent not found", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([]); // No agent row

      const svc = autoClaimService(db);
      const policy = await svc.getPolicy("co-1", "ghost-agent");

      expect(policy.maxConcurrentClaims).toBe(1);
    });
  });

  describe("findNextCandidate", () => {
    it("returns null when no eligible issues", async () => {
      const { db, pushRows } = makeMockDb();
      // Step 1: candidates query — empty
      pushRows([]);
      // Step 2: blocked edges not queried (rows.length === 0 exits early)

      const svc = autoClaimService(db);
      const policy: AutoClaimPolicy = {
        maxConcurrentClaims: 1,
        claimableStatuses: ["backlog", "todo"],
        priorityOrder: "priority_first",
        projectScope: null,
        respectDependencies: true,
      };

      const candidate = await svc.findNextCandidate("co-1", "agent-1", policy);
      expect(candidate).toBeNull();
    });

    it("returns highest priority candidate first", async () => {
      const { db, pushRows } = makeMockDb();
      // Step 1: candidates
      pushRows([
        makeIssue({ id: "issue-low", priority: "low" }),
        makeIssue({ id: "issue-critical", priority: "critical" }),
        makeIssue({ id: "issue-medium", priority: "medium" }),
      ]);
      // Step 2: blocked edges — none blocked
      pushRows([]);

      const svc = autoClaimService(db);
      const policy: AutoClaimPolicy = {
        maxConcurrentClaims: 1,
        claimableStatuses: ["todo"],
        priorityOrder: "priority_first",
        projectScope: null,
        respectDependencies: true,
      };

      const candidate = await svc.findNextCandidate("co-1", "agent-1", policy);
      expect(candidate?.id).toBe("issue-critical");
    });

    it("returns oldest issue first with created_first ordering", async () => {
      const { db, pushRows } = makeMockDb();
      // Step 1: candidates
      pushRows([
        makeIssue({ id: "issue-new", createdAt: new Date("2026-04-02") }),
        makeIssue({ id: "issue-old", createdAt: new Date("2026-03-01") }),
      ]);
      // Step 2: respectDependencies=false → no blocked edges query

      const svc = autoClaimService(db);
      const policy: AutoClaimPolicy = {
        maxConcurrentClaims: 1,
        claimableStatuses: ["todo"],
        priorityOrder: "created_first",
        projectScope: null,
        respectDependencies: false,
      };

      const candidate = await svc.findNextCandidate("co-1", "agent-1", policy);
      expect(candidate?.id).toBe("issue-old");
    });

    it("filters out issues with active blockers", async () => {
      const { db, pushRows } = makeMockDb();
      // Step 1: two candidates
      pushRows([
        makeIssue({ id: "issue-blocked", priority: "critical" }),
        makeIssue({ id: "issue-free", priority: "medium" }),
      ]);
      // Step 2: blocked edges — issue-blocked is blocked
      pushRows([{ issueId: "issue-blocked" }]);

      const svc = autoClaimService(db);
      const policy: AutoClaimPolicy = {
        maxConcurrentClaims: 1,
        claimableStatuses: ["todo"],
        priorityOrder: "priority_first",
        projectScope: null,
        respectDependencies: true,
      };

      const candidate = await svc.findNextCandidate("co-1", "agent-1", policy);
      // Critical is blocked, so medium free issue is chosen
      expect(candidate?.id).toBe("issue-free");
    });
  });

  describe("claimIssue", () => {
    it("returns true when update succeeds", async () => {
      const { db } = makeMockDb();

      const svc = autoClaimService(db);
      const result = await svc.claimIssue("co-1", "agent-1", "issue-1");

      expect(result).toBe(true);
      expect(db.update).toHaveBeenCalled();
    });

    it("returns false when another agent claimed first (race condition)", async () => {
      const { db, setUpdateReturnEmpty } = makeMockDb();
      setUpdateReturnEmpty(true); // UPDATE matched 0 rows

      const svc = autoClaimService(db);
      const result = await svc.claimIssue("co-1", "agent-1", "issue-1");

      expect(result).toBe(false);
    });
  });

  describe("tryAutoClaim", () => {
    it("returns flag_off when feature flag is disabled", async () => {
      const { db, pushRows } = makeMockDb({ flagEnabled: false });
      pushRows([{ experimental: { featureFlags: { auto_claim: false } } }]);

      const svc = autoClaimService(db);
      const result = await svc.tryAutoClaim("co-1", "agent-1");

      expect(result.claimed).toBe(false);
      expect(result.reason).toBe("flag_off");
    });

    it("returns max_reached when agent already at concurrent limit", async () => {
      const { db, pushRows } = makeMockDb();
      // Flag enabled
      pushRows([{ experimental: { featureFlags: { auto_claim: true } } }]);
      // getPolicy — no autoClaim config (default maxConcurrentClaims=1)
      pushRows([{ runtimeConfig: {} }]);
      // countActiveIssues — returns 1 active issue
      pushRows([{ id: "issue-active" }]);

      const svc = autoClaimService(db);
      const result = await svc.tryAutoClaim("co-1", "agent-1");

      expect(result.claimed).toBe(false);
      expect(result.reason).toBe("max_reached");
    });

    it("returns no_eligible when no unassigned issues exist", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([{ experimental: { featureFlags: { auto_claim: true } } }]);
      // getPolicy
      pushRows([{ runtimeConfig: {} }]);
      // countActiveIssues — 0 active
      pushRows([]);
      // findNextCandidate step 1 — no candidates
      pushRows([]);
      // step 2 (blocked edges) not reached since candidates are empty

      const svc = autoClaimService(db);
      const result = await svc.tryAutoClaim("co-1", "agent-1");

      expect(result.claimed).toBe(false);
      expect(result.reason).not.toBe("claimed");
    });

    it("returns claimed with issueId on success", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([{ experimental: { featureFlags: { auto_claim: true } } }]);
      // getPolicy
      pushRows([{ runtimeConfig: {} }]);
      // countActiveIssues — 0 active
      pushRows([]);
      // findNextCandidate step 1 — one candidate
      pushRows([makeIssue({ id: "issue-claimable" })]);
      // findNextCandidate step 2 — no blocked edges
      pushRows([]);

      const svc = autoClaimService(db);
      const result = await svc.tryAutoClaim("co-1", "agent-1");

      expect(result.claimed).toBe(true);
      expect(result.issueId).toBe("issue-claimable");
      expect(result.reason).toBe("claimed");
    });

    it("returns no_eligible when optimistic lock fails (race condition)", async () => {
      const { db, pushRows, setUpdateReturnEmpty } = makeMockDb();
      pushRows([{ experimental: { featureFlags: { auto_claim: true } } }]);
      // getPolicy
      pushRows([{ runtimeConfig: {} }]);
      // countActiveIssues — 0 active
      pushRows([]);
      // findNextCandidate step 1 — one candidate
      pushRows([makeIssue({ id: "issue-raced" })]);
      // findNextCandidate step 2 — no blocked edges
      pushRows([]);
      // UPDATE matches 0 rows (race)
      setUpdateReturnEmpty(true);

      const svc = autoClaimService(db);
      const result = await svc.tryAutoClaim("co-1", "agent-1");

      expect(result.claimed).toBe(false);
      expect(result.reason).toBe("no_eligible");
    });
  });
});
