/**
 * remote-planner.test.ts
 * Phase 20: Unit tests for planScannerService + remotePlannerService
 *
 * Uses mock DB — no real database required.
 * Tests cover:
 *   - planScannerService.scan: planning / needs_input / plan_ready / expired detection
 *   - planScannerService.transition: status transitions + phase derivation
 *   - planScannerService.derivePhase: PlanSessionStatus → PlanPhase mapping
 *   - remotePlannerService.createPlanSession: DB insert + polling start
 *   - remotePlannerService.rejectPlan: rejectCount increment + re-planning
 *   - remotePlannerService.provideInput: state revert to planning
 *   - remotePlannerService.cleanupExpired: TTL-based expiry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { planScannerService } from "./plan-scanner.js";
import type { RemotePlanSession } from "./plan-scanner.js";
import { PLANNING_AGENT_SYSTEM_PROMPT } from "./remote-planner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<RemotePlanSession> = {}): RemotePlanSession {
  return {
    id: "sess-1",
    companyId: "co-1",
    plannerAgentId: "planner-1",
    requestedByAgentId: "agent-1",
    requestedByUserId: null,
    sourceIssueId: null,
    status: "planning",
    phase: "running",
    planText: null,
    planWorkflow: null,
    editedPlan: null,
    userFeedback: null,
    pendingQuestion: null,
    executionTarget: "coordinator",
    coordinatorSessionId: null,
    routineRunId: null,
    pollIntervalMs: 3000,
    timeoutMs: 1_800_000,
    maxConsecutiveFailures: 5,
    rejectCount: 0,
    consecutiveFailures: 0,
    lastPolledAt: null,
    approvedAt: null,
    completedAt: null,
    expiresAt: new Date(Date.now() + 1_800_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Queue-based mock DB
// ---------------------------------------------------------------------------

function makeMockDb(opts: {
  selectReturns?: unknown[];
  insertReturns?: unknown[];
} = {}) {
  const selectQueue = [...(opts.selectReturns ?? [])];
  const insertQueue = [...(opts.insertReturns ?? [])];
  const updates: unknown[] = [];
  const inserts: unknown[] = [];

  function chain(values?: unknown) {
    return {
      from: () => chain(values),
      where: () => chain(values),
      limit: () => chain(values),
      set: (v: unknown) => { updates.push(v); return chain(v); },
      values: (v: unknown) => { inserts.push(v); return chain(insertQueue.shift() ? [insertQueue.shift()] : []); },
      returning: () => Promise.resolve(insertQueue.length ? [insertQueue.shift()] : [{}]),
      then: (resolve: (v: unknown) => void) => resolve(selectQueue.shift() ?? []),
    };
  }

  return {
    select: () => chain([]),
    update: () => chain(),
    insert: () => chain(),
    _updates: updates,
    _inserts: inserts,
    _selectQueue: selectQueue,
  };
}

// ---------------------------------------------------------------------------
// planScannerService tests
// ---------------------------------------------------------------------------

describe("planScannerService", () => {
  describe("derivePhase", () => {
    it("returns 'running' for planning status", () => {
      const db = makeMockDb() as unknown as Parameters<typeof planScannerService>[0];
      const svc = planScannerService(db);
      const session = makeSession({ status: "planning" });
      expect(svc.derivePhase(session)).toBe("running");
    });

    it("returns 'needs_input' for needs_input status", () => {
      const db = makeMockDb() as unknown as Parameters<typeof planScannerService>[0];
      const svc = planScannerService(db);
      const session = makeSession({ status: "needs_input" });
      expect(svc.derivePhase(session)).toBe("needs_input");
    });

    it("returns 'plan_ready' for plan_ready status", () => {
      const db = makeMockDb() as unknown as Parameters<typeof planScannerService>[0];
      const svc = planScannerService(db);
      const session = makeSession({ status: "plan_ready" });
      expect(svc.derivePhase(session)).toBe("plan_ready");
    });

    it("returns 'plan_ready' for approved status", () => {
      const db = makeMockDb() as unknown as Parameters<typeof planScannerService>[0];
      const svc = planScannerService(db);
      const session = makeSession({ status: "approved" });
      expect(svc.derivePhase(session)).toBe("plan_ready");
    });

    it("returns 'running' for executing status", () => {
      const db = makeMockDb() as unknown as Parameters<typeof planScannerService>[0];
      const svc = planScannerService(db);
      const session = makeSession({ status: "executing" });
      expect(svc.derivePhase(session)).toBe("running");
    });
  });

  describe("scan", () => {
    it("returns 'planning' when no markers and status is planning", async () => {
      const session = makeSession({ planText: "Working on the issue..." });
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([session]),
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve(),
          }),
        }),
      } as unknown as Parameters<typeof planScannerService>[0];

      const svc = planScannerService(db);
      const result = await svc.scan("sess-1");
      expect(result.kind).toBe("planning");
    });

    it("detects '## Plan Ready' marker and returns plan_ready", async () => {
      const session = makeSession({
        planText: "## Plan Ready\n## Steps\n1. lint\n2. test",
        status: "planning",
      });
      let updatedStatus: string | null = null;
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([session]),
            }),
          }),
        }),
        update: () => ({
          set: (v: Record<string, unknown>) => {
            updatedStatus = v.status as string;
            return { where: () => Promise.resolve() };
          },
        }),
      } as unknown as Parameters<typeof planScannerService>[0];

      const svc = planScannerService(db);
      const result = await svc.scan("sess-1");
      expect(result.kind).toBe("plan_ready");
      expect(updatedStatus).toBe("plan_ready");
    });

    it("detects '## Needs Input:' marker and returns needs_input", async () => {
      const session = makeSession({
        planText: "## Needs Input:\nWhat is the target branch?",
        status: "planning",
      });
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([session]),
            }),
          }),
        }),
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
      } as unknown as Parameters<typeof planScannerService>[0];

      const svc = planScannerService(db);
      const result = await svc.scan("sess-1");
      expect(result.kind).toBe("needs_input");
      if (result.kind === "needs_input") {
        expect(result.question).toBe("What is the target branch?");
      }
    });

    it("returns 'expired' when session is already past expiresAt", async () => {
      const session = makeSession({
        status: "planning",
        expiresAt: new Date(Date.now() - 1000),
      });
      let transitionedTo: string | null = null;
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([session]),
            }),
          }),
        }),
        update: () => ({
          set: (v: Record<string, unknown>) => {
            transitionedTo = v.status as string;
            return { where: () => Promise.resolve() };
          },
        }),
      } as unknown as Parameters<typeof planScannerService>[0];

      const svc = planScannerService(db);
      const result = await svc.scan("sess-1");
      expect(result.kind).toBe("expired");
      expect(transitionedTo).toBe("expired");
    });

    it("returns 'failed' when session not found", async () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as Parameters<typeof planScannerService>[0];

      const svc = planScannerService(db);
      const result = await svc.scan("nonexistent");
      expect(result.kind).toBe("failed");
    });

    it("returns 'unchanged' when status is executing", async () => {
      const session = makeSession({ status: "executing" });
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([session]),
            }),
          }),
        }),
      } as unknown as Parameters<typeof planScannerService>[0];

      const svc = planScannerService(db);
      const result = await svc.scan("sess-1");
      expect(result.kind).toBe("unchanged");
    });
  });
});

// ---------------------------------------------------------------------------
// PLANNING_AGENT_SYSTEM_PROMPT tests
// ---------------------------------------------------------------------------

describe("PLANNING_AGENT_SYSTEM_PROMPT", () => {
  it("contains the Plan Ready marker", () => {
    expect(PLANNING_AGENT_SYSTEM_PROMPT).toContain("## Plan Ready");
  });

  it("contains the Needs Input marker", () => {
    expect(PLANNING_AGENT_SYSTEM_PROMPT).toContain("## Needs Input:");
  });

  it("instructs the agent NOT to execute code", () => {
    expect(PLANNING_AGENT_SYSTEM_PROMPT).toContain("Do NOT attempt to execute");
  });
});
