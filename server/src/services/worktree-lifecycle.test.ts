/**
 * worktree-lifecycle.test.ts
 * Phase 22: Unit tests for worktreeLifecycleService
 *
 * Uses queue-based mock DB — no real database required.
 * Tests cover:
 *   - isEnabled: flag-gated detection
 *   - findReusableWorktree: idle git_worktree lookup
 *   - activateReusedWorktree: DB activation
 *   - release: idle transition
 *   - markForCleanup: cleanupEligibleAt scheduling
 *   - cleanupStale: archival of past-eligibility worktrees
 */

import { describe, it, expect, vi } from "vitest";
import { worktreeLifecycleService } from "./worktree-lifecycle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkspaceRow(overrides: Partial<{
  id: string;
  companyId: string;
  projectId: string;
  providerType: string;
  status: string;
  providerRef: string;
  branchName: string;
  lastUsedAt: Date;
  cleanupEligibleAt: Date | null;
}> = {}) {
  return {
    id: "ws-1",
    companyId: "co-1",
    projectId: "proj-1",
    providerType: "git_worktree",
    status: "idle",
    providerRef: "/repos/project/.paperclip/worktrees/issue-123-fix",
    branchName: "issue-123-fix",
    lastUsedAt: new Date("2026-04-01T00:00:00Z"),
    cleanupEligibleAt: null,
    ...overrides,
  };
}

/**
 * Queue-based mock DB.
 * Each select().from().where() call pops the next pre-loaded row set.
 * .where() returns a thenable that also supports .limit() chaining.
 */
function makeMockDb(opts: { flagEnabled?: boolean } = {}) {
  const flagEnabled = opts.flagEnabled ?? true;
  const rowQueue: unknown[][] = [];
  let lastUpdateSet: unknown = null;
  let lastUpdateWhere: unknown = null;

  function pushRows(...sets: unknown[][]) {
    for (const set of sets) rowQueue.push(set);
  }

  function nextRows(): unknown[] {
    const next = rowQueue.shift();
    if (next !== undefined) return next;
    // Default: feature flag row
    return [
      { experimental: { featureFlags: { worktree_isolation: flagEnabled } } },
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
            orderBy: vi.fn((_ord: unknown) => ({
              limit: vi.fn((_n: number) => Promise.resolve(getResult())),
            })),
          };
        }),
        orderBy: vi.fn((_ord: unknown) => ({
          limit: vi.fn((_n: number) => Promise.resolve(nextRows())),
        })),
      })),
    })),

    update: vi.fn((_table: unknown) => ({
      set: vi.fn((values: unknown) => {
        lastUpdateSet = values;
        return {
          where: vi.fn((cond: unknown) => {
            lastUpdateWhere = cond;
            return Promise.resolve();
          }),
        };
      }),
    })),
  };

  return {
    db: db as any,
    pushRows,
    getLastUpdateSet: () => lastUpdateSet,
    getLastUpdateWhere: () => lastUpdateWhere,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("worktreeLifecycleService", () => {
  describe("isEnabled", () => {
    it("returns false when flag is disabled", async () => {
      const { db, pushRows } = makeMockDb({ flagEnabled: false });
      pushRows([{ experimental: { featureFlags: { worktree_isolation: false } } }]);

      const svc = worktreeLifecycleService(db);
      expect(await svc.isEnabled()).toBe(false);
    });

    it("returns true when flag is enabled", async () => {
      const { db, pushRows } = makeMockDb({ flagEnabled: true });
      pushRows([{ experimental: { featureFlags: { worktree_isolation: true } } }]);

      const svc = worktreeLifecycleService(db);
      expect(await svc.isEnabled()).toBe(true);
    });
  });

  describe("findReusableWorktree", () => {
    it("returns null when no idle worktree exists for project", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([]); // Empty result

      const svc = worktreeLifecycleService(db);
      const result = await svc.findReusableWorktree("co-1", "proj-1");

      expect(result).toBeNull();
    });

    it("returns the idle git_worktree workspace", async () => {
      const { db, pushRows } = makeMockDb();
      const ws = makeWorkspaceRow({ id: "ws-idle-1", status: "idle" });
      pushRows([ws]);

      const svc = worktreeLifecycleService(db);
      const result = await svc.findReusableWorktree("co-1", "proj-1");

      expect(result?.id).toBe("ws-idle-1");
      expect(result?.status).toBe("idle");
      expect(result?.providerType).toBe("git_worktree");
    });
  });

  describe("activateReusedWorktree", () => {
    it("calls update with status=active and new issueId", async () => {
      const { db, getLastUpdateSet } = makeMockDb();

      const svc = worktreeLifecycleService(db);
      await svc.activateReusedWorktree("ws-1", "issue-new");

      const updateSet = getLastUpdateSet() as Record<string, unknown>;
      expect(updateSet.status).toBe("active");
      expect(updateSet.sourceIssueId).toBe("issue-new");
      expect(updateSet.cleanupEligibleAt).toBeNull();
      expect(updateSet.cleanupReason).toBeNull();
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe("release", () => {
    it("transitions workspace to idle status", async () => {
      const { db, getLastUpdateSet } = makeMockDb();

      const svc = worktreeLifecycleService(db);
      await svc.release("ws-1");

      const updateSet = getLastUpdateSet() as Record<string, unknown>;
      expect(updateSet.status).toBe("idle");
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe("markForCleanup", () => {
    it("sets cleanupEligibleAt and cleanupReason", async () => {
      const { db, getLastUpdateSet } = makeMockDb();

      const svc = worktreeLifecycleService(db);
      await svc.markForCleanup("co-1", "issue-1", "issue_completed", 60);

      const updateSet = getLastUpdateSet() as Record<string, unknown>;
      expect(updateSet.cleanupReason).toBe("issue_completed");
      expect(updateSet.cleanupEligibleAt).toBeInstanceOf(Date);
      // Should be ~60 minutes in the future
      const eligibleAt = updateSet.cleanupEligibleAt as Date;
      const diffMs = eligibleAt.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(59 * 60 * 1000); // at least 59 minutes
      expect(diffMs).toBeLessThan(61 * 60 * 1000);    // at most 61 minutes
    });

    it("uses default idle time when not specified", async () => {
      const { db, getLastUpdateSet } = makeMockDb();

      const svc = worktreeLifecycleService(db);
      await svc.markForCleanup("co-1", "issue-1", "issue_completed");

      const updateSet = getLastUpdateSet() as Record<string, unknown>;
      const eligibleAt = updateSet.cleanupEligibleAt as Date;
      // Default is 1440 minutes (24h)
      const diffMs = eligibleAt.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(23.9 * 60 * 60 * 1000);
    });
  });

  describe("cleanupStale", () => {
    it("returns 0 when no stale worktrees found", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([]); // No stale results

      const svc = worktreeLifecycleService(db);
      const count = await svc.cleanupStale("co-1");

      expect(count).toBe(0);
      expect(db.update).not.toHaveBeenCalled();
    });

    it("archives stale worktrees and returns count", async () => {
      const { db, pushRows, getLastUpdateSet } = makeMockDb();
      // Two stale worktrees found
      pushRows([
        { id: "ws-stale-1" },
        { id: "ws-stale-2" },
      ]);

      const svc = worktreeLifecycleService(db);
      const count = await svc.cleanupStale("co-1");

      expect(count).toBe(2);
      expect(db.update).toHaveBeenCalled();
      const updateSet = getLastUpdateSet() as Record<string, unknown>;
      expect(updateSet.status).toBe("archived");
      expect(updateSet.cleanupReason).toBe("stale_cleanup");
      expect(updateSet.closedAt).toBeInstanceOf(Date);
    });

    it("respects custom policy maxIdleMinutes", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([{ id: "ws-1" }]);

      const svc = worktreeLifecycleService(db);
      const count = await svc.cleanupStale("co-1", { maxIdleMinutes: 30 });

      expect(count).toBe(1);
    });
  });
});
