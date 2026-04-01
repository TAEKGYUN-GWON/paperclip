/**
 * coordinator.test.ts
 * Phase 19: Unit tests for CoordinatorService
 *
 * Uses queue-based mock DB — no real database required.
 * Tests cover:
 *   - isCoordinatorAgent: flag-gated detection
 *   - startCoordination: session creation, duplicate prevention
 *   - delegate: task creation, worker assignment strategies
 *   - onWorkerComplete: status transitions, session completion
 *   - getStatus: aggregation
 *   - buildCoordinatorPrompt: prompt generation
 *   - cancelSession: cancellation cascade
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { coordinatorService } from "./coordinator.js";
import type { CoordinatorSession, WorkerTask } from "./coordinator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(
  overrides: Partial<CoordinatorSession> = {},
): CoordinatorSession {
  return {
    id: "session-1",
    companyId: "co-1",
    coordinatorAgentId: "agent-coordinator",
    parentIssueId: "issue-parent",
    status: "active",
    maxParallelWorkers: 5,
    delegationStrategy: "round_robin",
    config: {},
    startedAt: new Date("2026-04-01T00:00:00Z"),
    completedAt: null,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

function makeWorkerTask(
  overrides: Partial<WorkerTask> = {},
): WorkerTask {
  return {
    id: "wt-1",
    companyId: "co-1",
    coordinatorSessionId: "session-1",
    parentIssueId: "issue-parent",
    subIssueId: null,
    workerAgentId: "agent-worker-1",
    status: "pending",
    summary: "Test task",
    result: null,
    delegatedAt: null,
    completedAt: null,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Queue-based mock DB.
 * Each select().from().where() call pops the next pre-loaded row set.
 * .where() itself returns a thenable (Promise) AND supports .limit()/.groupBy() chaining.
 */
function makeMockDb(opts: { flagEnabled?: boolean } = {}) {
  const flagEnabled = opts.flagEnabled ?? true;
  const rowQueue: unknown[][] = [];
  let lastInsertedValues: unknown[] = [];

  function pushRows(...sets: unknown[][]) {
    for (const set of sets) {
      rowQueue.push(set);
    }
  }

  function nextRows(): unknown[] {
    const next = rowQueue.shift();
    if (next !== undefined) return next;
    return [
      {
        experimental: {
          featureFlags: { coordinator_mode: flagEnabled },
        },
      },
    ];
  }

  const db = {
    select: vi.fn((_fields?: unknown) => ({
      from: vi.fn((_table: unknown) => ({
        where: vi.fn((_cond: unknown) => {
          // The result is a thenable that also supports .limit() and .groupBy()
          let resolved: unknown[] | null = null;
          const getResult = () => {
            if (resolved === null) resolved = nextRows();
            return resolved;
          };
          return {
            then: (onFulfilled: any, onRejected?: any) =>
              Promise.resolve(getResult()).then(onFulfilled, onRejected),
            limit: vi.fn((_n: number) => Promise.resolve(getResult())),
            groupBy: vi.fn((_col: unknown) => Promise.resolve(getResult())),
          };
        }),
      })),
    })),

    insert: vi.fn((_table: unknown) => ({
      values: vi.fn((rows: unknown | unknown[]) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        lastInsertedValues = arr;
        const returningFn = vi.fn().mockImplementation(() => {
          return Promise.resolve(
            arr.map((r, i) => ({
              ...makeSession(),
              ...(r as Record<string, unknown>),
              id: `inserted-${i}`,
            })),
          );
        });
        return {
          returning: returningFn,
          onConflictDoUpdate: vi.fn().mockReturnValue({ returning: returningFn }),
        };
      }),
    })),

    update: vi.fn((_table: unknown) => ({
      set: vi.fn((_values: unknown) => ({
        where: vi.fn((_cond: unknown) => Promise.resolve()),
      })),
    })),

    delete: vi.fn((_table: unknown) => ({
      where: vi.fn((_cond: unknown) => Promise.resolve()),
    })),
  };

  return { db: db as any, pushRows, getLastInserted: () => lastInsertedValues };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("coordinatorService", () => {
  describe("isCoordinatorAgent", () => {
    it("returns false when flag is disabled", async () => {
      const { db, pushRows } = makeMockDb({ flagEnabled: false });
      // Feature flag query returns disabled
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: false } } },
      ]);

      const svc = coordinatorService(db);
      const result = await svc.isCoordinatorAgent("co-1", "agent-1");
      expect(result).toBe(false);
    });

    it("returns true when agent has active session", async () => {
      const { db, pushRows } = makeMockDb();
      // Feature flag query
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: true } } },
      ]);
      // Active session query
      pushRows([makeSession()]);

      const svc = coordinatorService(db);
      const result = await svc.isCoordinatorAgent("co-1", "agent-coordinator");
      expect(result).toBe(true);
    });

    it("returns false when agent has no active session", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: true } } },
      ]);
      pushRows([]); // No active sessions

      const svc = coordinatorService(db);
      const result = await svc.isCoordinatorAgent("co-1", "agent-unknown");
      expect(result).toBe(false);
    });
  });

  describe("startCoordination", () => {
    it("creates a new session when none exists", async () => {
      const { db, pushRows } = makeMockDb();
      // isEnabled flag check
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: true } } },
      ]);
      // getActiveSession — no existing session
      pushRows([]);

      const svc = coordinatorService(db);
      const session = await svc.startCoordination({
        companyId: "co-1",
        coordinatorAgentId: "agent-coordinator",
        parentIssueId: "issue-parent",
        maxParallelWorkers: 3,
      });

      expect(session).toBeDefined();
      expect(db.insert).toHaveBeenCalled();
    });

    it("throws when flag is disabled", async () => {
      const { db, pushRows } = makeMockDb({ flagEnabled: false });
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: false } } },
      ]);

      const svc = coordinatorService(db);
      await expect(
        svc.startCoordination({
          companyId: "co-1",
          coordinatorAgentId: "agent-coordinator",
          parentIssueId: "issue-parent",
        }),
      ).rejects.toThrow("coordinator_mode feature flag is not enabled");
    });

    it("throws when active session already exists", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: true } } },
      ]);
      // Existing active session
      pushRows([makeSession()]);

      const svc = coordinatorService(db);
      await expect(
        svc.startCoordination({
          companyId: "co-1",
          coordinatorAgentId: "agent-coordinator",
          parentIssueId: "issue-parent",
        }),
      ).rejects.toThrow("Active coordinator session already exists");
    });
  });

  describe("delegate", () => {
    it("throws when flag is disabled", async () => {
      const { db, pushRows } = makeMockDb({ flagEnabled: false });
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: false } } },
      ]);

      const svc = coordinatorService(db);
      await expect(
        svc.delegate("co-1", "session-1", { tasks: [] }),
      ).rejects.toThrow("coordinator_mode feature flag is not enabled");
    });

    it("throws when session not found", async () => {
      const { db, pushRows } = makeMockDb();
      // isEnabled
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: true } } },
      ]);
      // Session query — not found
      pushRows([]);

      const svc = coordinatorService(db);
      await expect(
        svc.delegate("co-1", "session-1", {
          tasks: [{ title: "test", description: "do it" }],
        }),
      ).rejects.toThrow("No active coordinator session found");
    });

    it("creates worker tasks with round-robin assignment", async () => {
      const { db, pushRows } = makeMockDb();
      // isEnabled
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: true } } },
      ]);
      // Session found
      pushRows([
        makeSession({
          config: { workerAgentIds: ["w1", "w2", "w3"] },
        }),
      ]);
      // Count existing tasks
      pushRows([{ cnt: 0 }]);

      const svc = coordinatorService(db);
      const tasks = await svc.delegate("co-1", "session-1", {
        tasks: [
          { title: "Task A", description: "Do A" },
          { title: "Task B", description: "Do B" },
          { title: "Task C", description: "Do C" },
        ],
      });

      expect(db.insert).toHaveBeenCalled();
      expect(tasks.length).toBe(3);
    });

    it("enforces max sub-issues limit", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: true } } },
      ]);
      pushRows([makeSession()]);
      // Already at limit
      pushRows([{ cnt: 20 }]);

      const svc = coordinatorService(db);
      await expect(
        svc.delegate("co-1", "session-1", {
          tasks: [{ title: "one more", description: "overflow" }],
        }),
      ).rejects.toThrow("Exceeds maximum sub-issues per session");
    });
  });

  describe("onWorkerComplete", () => {
    it("returns false when flag is disabled", async () => {
      const { db, pushRows } = makeMockDb({ flagEnabled: false });
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: false } } },
      ]);

      const svc = coordinatorService(db);
      const result = await svc.onWorkerComplete("co-1", "sub-issue-1", "succeeded");
      expect(result).toBe(false);
    });

    it("returns false when no worker task matches", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: true } } },
      ]);
      // No matching worker task
      pushRows([]);

      const svc = coordinatorService(db);
      const result = await svc.onWorkerComplete("co-1", "sub-issue-1", "succeeded");
      expect(result).toBe(false);
    });

    it("completes session when all tasks are terminal", async () => {
      const { db, pushRows } = makeMockDb();
      // isEnabled
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: true } } },
      ]);
      // Find worker task by subIssueId
      pushRows([
        makeWorkerTask({
          id: "wt-1",
          subIssueId: "sub-issue-1",
          coordinatorSessionId: "session-1",
        }),
      ]);
      // After update, get all session tasks — all terminal
      pushRows([
        { status: "completed" },
        { status: "completed" },
      ]);

      const svc = coordinatorService(db);
      const allDone = await svc.onWorkerComplete("co-1", "sub-issue-1", "succeeded");
      expect(allDone).toBe(true);
      // Session should be updated to completed
      expect(db.update).toHaveBeenCalled();
    });

    it("does not complete session when tasks remain", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([
        { experimental: { featureFlags: { coordinator_mode: true } } },
      ]);
      pushRows([
        makeWorkerTask({
          subIssueId: "sub-issue-1",
          coordinatorSessionId: "session-1",
        }),
      ]);
      // Still have running task
      pushRows([
        { status: "completed" },
        { status: "running" },
      ]);

      const svc = coordinatorService(db);
      const allDone = await svc.onWorkerComplete("co-1", "sub-issue-1", "succeeded");
      expect(allDone).toBe(false);
    });
  });

  describe("getStatus", () => {
    it("returns null when no session exists", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([]); // No session

      const svc = coordinatorService(db);
      const status = await svc.getStatus("co-1", "issue-parent");
      expect(status).toBeNull();
    });

    it("returns aggregated status", async () => {
      const { db, pushRows } = makeMockDb();
      // Session query
      pushRows([makeSession()]);
      // Worker task statuses
      pushRows([
        { status: "completed" },
        { status: "running" },
        { status: "pending" },
        { status: "failed" },
      ]);

      const svc = coordinatorService(db);
      const status = await svc.getStatus("co-1", "issue-parent");

      expect(status).not.toBeNull();
      expect(status!.totalTasks).toBe(4);
      expect(status!.completedTasks).toBe(1);
      expect(status!.failedTasks).toBe(1);
      expect(status!.runningTasks).toBe(1);
      expect(status!.pendingTasks).toBe(1);
      expect(status!.isComplete).toBe(false);
    });
  });

  describe("buildCoordinatorPrompt", () => {
    it("returns null when no session exists", async () => {
      const { db, pushRows } = makeMockDb();
      pushRows([]); // No session for getStatus

      const svc = coordinatorService(db);
      const prompt = await svc.buildCoordinatorPrompt(
        "co-1",
        "agent-coordinator",
        "issue-parent",
      );
      expect(prompt).toBeNull();
    });

    it("generates markdown prompt with task summary", async () => {
      const { db, pushRows } = makeMockDb();
      // getStatus → session
      pushRows([makeSession()]);
      // getStatus → task statuses
      pushRows([
        { status: "completed" },
        { status: "running" },
      ]);
      // buildCoordinatorPrompt → task details
      pushRows([
        makeWorkerTask({ status: "completed", summary: "Build API" }),
        makeWorkerTask({ id: "wt-2", status: "running", summary: "Write tests", workerAgentId: "agent-w2" }),
      ]);

      const svc = coordinatorService(db);
      const prompt = await svc.buildCoordinatorPrompt(
        "co-1",
        "agent-coordinator",
        "issue-parent",
      );

      expect(prompt).not.toBeNull();
      expect(prompt).toContain("Coordinator Status");
      expect(prompt).toContain("Worker Tasks");
      expect(prompt).toContain("[DONE]");
      expect(prompt).toContain("[RUNNING]");
    });
  });

  describe("cancelSession", () => {
    it("cancels session and all non-terminal tasks", async () => {
      const { db } = makeMockDb();

      const svc = coordinatorService(db);
      await svc.cancelSession("co-1", "session-1");

      // Should call update twice: once for worker_tasks, once for session
      expect(db.update).toHaveBeenCalledTimes(2);
    });
  });
});
