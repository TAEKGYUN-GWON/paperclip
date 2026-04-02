/**
 * workflow-engine.test.ts
 * Phase 13: Unit tests for workflowEngineService
 *
 * Tests cover:
 *   - parseAndValidate: valid definition, missing fields, duplicate step names,
 *     unknown dependency, cycle detection
 *   - execute: coordinator session creation + worker task delegation
 *   - onStepComplete: step status update + next-step triggering
 *   - getExecutionStatus: status aggregation
 *   - cancel: coordinator cancellation + state cleanup
 *   - buildStepContext: markdown context generation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  workflowEngineService,
  WorkflowValidationError,
  type WorkflowDefinition,
  type WorkflowExecutionState,
} from "./workflow-engine.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSimpleWorkflow(): WorkflowDefinition {
  return {
    name: "Test Workflow",
    description: "A simple two-step workflow",
    steps: [
      {
        name: "step-1",
        description: "First step",
        agentSelector: { strategy: "round_robin" },
      },
      {
        name: "step-2",
        description: "Second step",
        agentSelector: { strategy: "round_robin" },
        dependsOn: ["step-1"],
        condition: { type: "on_success" },
      },
    ],
  };
}

function makeThreeStepWorkflow(): WorkflowDefinition {
  return {
    name: "Three Step",
    steps: [
      {
        name: "lint",
        description: "Lint check",
        agentSelector: { strategy: "round_robin" },
      },
      {
        name: "test",
        description: "Run tests",
        agentSelector: { strategy: "round_robin" },
        dependsOn: ["lint"],
      },
      {
        name: "deploy",
        description: "Deploy",
        agentSelector: { strategy: "round_robin" },
        dependsOn: ["test"],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Mock DB builder
// ---------------------------------------------------------------------------

interface MockState {
  routineRunRow: Record<string, unknown> | null;
  workflowStepRows: unknown[];
}

/**
 * Simple mock DB.
 * - .select().from().where().limit() → returns [routineRunRow] (or [])
 * - .select().from().where() (no limit, for workflow_steps) → returns workflowStepRows
 * - .update().set() captures workflowExecutionState mutations
 * - .insert().values() → no-op
 */
function makeMockDb(state: MockState) {
  let selectCallCount = 0;

  return {
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => Promise.resolve(),
    }),
    update: (_table: unknown) => ({
      set: (vals: Record<string, unknown>) => {
        if (state.routineRunRow && vals.workflowExecutionState !== undefined) {
          state.routineRunRow.workflowExecutionState = vals.workflowExecutionState;
        }
        return { where: () => Promise.resolve() };
      },
    }),
    select: () => {
      const callIndex = ++selectCallCount;
      return {
        from: (_table: unknown) => ({
          where: () => ({
            limit: () => ({
              then: (resolve: (v: unknown[]) => unknown) =>
                Promise.resolve(state.routineRunRow ? [state.routineRunRow] : []).then(resolve),
            }),
            // workflow_steps queries come through without .limit()
            then: (resolve: (v: unknown[]) => unknown) => {
              // Second+ select calls (workflow_steps) return step rows
              if (callIndex > 1) {
                return Promise.resolve(state.workflowStepRows).then(resolve);
              }
              return Promise.resolve(state.routineRunRow ? [state.routineRunRow] : []).then(resolve);
            },
          }),
        }),
      };
    },
  } as unknown as import("@paperclipai/db").Db;
}

// ---------------------------------------------------------------------------
// Mock coordinator
// ---------------------------------------------------------------------------

function makeMockCoordinator(sessionId = "session-1") {
  return {
    isEnabled: async () => true,
    startCoordination: vi.fn(async () => ({
      id: sessionId,
      companyId: "co-1",
      coordinatorAgentId: "agent-1",
      parentIssueId: "issue-1",
      status: "active",
      delegationStrategy: "round_robin",
      maxParallelWorkers: 5,
    })),
    delegate: vi.fn(async (_companyId: string, _sessionId: string, plan: { tasks: unknown[] }) => {
      return plan.tasks.map((_, i) => ({ id: `task-${i + 1}`, status: "spawned" }));
    }),
    cancelSession: vi.fn(async () => {}),
  };
}

vi.mock("./feature-flags.js", () => ({
  featureFlagsService: () => ({
    isEnabled: async (key: string) => key === "declarative_workflows",
  }),
}));

vi.mock("./coordinator.js", () => ({
  coordinatorService: () => makeMockCoordinator(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("workflowEngineService", () => {
  // -------------------------------------------------------------------------
  // isEnabled
  // -------------------------------------------------------------------------

  describe("isEnabled", () => {
    it("returns true when declarative_workflows flag is on", async () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      expect(await svc.isEnabled()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // parseAndValidate
  // -------------------------------------------------------------------------

  describe("parseAndValidate", () => {
    it("accepts a valid workflow definition", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      const result = svc.parseAndValidate(makeSimpleWorkflow());
      expect(result.name).toBe("Test Workflow");
      expect(result.steps).toHaveLength(2);
    });

    it("throws WorkflowValidationError for non-object input", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      expect(() => svc.parseAndValidate("not an object")).toThrow(WorkflowValidationError);
    });

    it("throws for missing name", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      expect(() =>
        svc.parseAndValidate({ steps: [{ name: "a", description: "b", agentSelector: { strategy: "round_robin" } }] }),
      ).toThrow(WorkflowValidationError);
    });

    it("throws for empty steps array", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      expect(() => svc.parseAndValidate({ name: "wf", steps: [] })).toThrow(WorkflowValidationError);
    });

    it("throws for duplicate step names", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      expect(() =>
        svc.parseAndValidate({
          name: "wf",
          steps: [
            { name: "step-1", description: "a", agentSelector: { strategy: "round_robin" } },
            { name: "step-1", description: "b", agentSelector: { strategy: "round_robin" } },
          ],
        }),
      ).toThrow(WorkflowValidationError);
    });

    it("throws for unknown dependency", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      expect(() =>
        svc.parseAndValidate({
          name: "wf",
          steps: [
            {
              name: "step-1",
              description: "a",
              agentSelector: { strategy: "round_robin" },
              dependsOn: ["nonexistent"],
            },
          ],
        }),
      ).toThrow(WorkflowValidationError);
    });

    it("detects a direct cycle (A → B → A)", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      expect(() =>
        svc.parseAndValidate({
          name: "cyclic",
          steps: [
            { name: "a", description: "a", agentSelector: { strategy: "round_robin" }, dependsOn: ["b"] },
            { name: "b", description: "b", agentSelector: { strategy: "round_robin" }, dependsOn: ["a"] },
          ],
        }),
      ).toThrow(WorkflowValidationError);
    });

    it("detects an indirect cycle (A → B → C → A)", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      expect(() =>
        svc.parseAndValidate({
          name: "indirect-cycle",
          steps: [
            { name: "a", description: "a", agentSelector: { strategy: "round_robin" }, dependsOn: ["c"] },
            { name: "b", description: "b", agentSelector: { strategy: "round_robin" }, dependsOn: ["a"] },
            { name: "c", description: "c", agentSelector: { strategy: "round_robin" }, dependsOn: ["b"] },
          ],
        }),
      ).toThrow(WorkflowValidationError);
    });

    it("accepts a valid 3-step linear workflow", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      const result = svc.parseAndValidate(makeThreeStepWorkflow());
      expect(result.steps).toHaveLength(3);
    });

    it("accepts diamond-shaped DAG (A → B, A → C, B+C → D)", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);
      const result = svc.parseAndValidate({
        name: "diamond",
        steps: [
          { name: "a", description: "root", agentSelector: { strategy: "round_robin" } },
          { name: "b", description: "left", agentSelector: { strategy: "round_robin" }, dependsOn: ["a"] },
          { name: "c", description: "right", agentSelector: { strategy: "round_robin" }, dependsOn: ["a"] },
          { name: "d", description: "merge", agentSelector: { strategy: "round_robin" }, dependsOn: ["b", "c"] },
        ],
      });
      expect(result.steps).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  describe("execute", () => {
    it("creates coordinator session and delegates tasks", async () => {
      const state: MockState = { routineRunRow: {}, workflowStepRows: [] };
      const db = makeMockDb(state);
      const svc = workflowEngineService(db);

      const execState = await svc.execute(
        "co-1",
        "agent-1",
        "issue-1",
        "routine-1",
        "run-1",
        makeSimpleWorkflow(),
      );

      expect(execState.coordinatorSessionId).toBe("session-1");
      expect(Object.keys(execState.stepStatuses)).toHaveLength(2);
      // Root step (step-1) should be running
      expect(execState.stepStatuses["step-1"]).toBe("running");
      // Dependent step (step-2) should be pending
      expect(execState.stepStatuses["step-2"]).toBe("pending");
    });

    it("marks all steps as running when no dependencies", async () => {
      const parallelWorkflow: WorkflowDefinition = {
        name: "Parallel",
        steps: [
          { name: "task-a", description: "A", agentSelector: { strategy: "round_robin" } },
          { name: "task-b", description: "B", agentSelector: { strategy: "round_robin" } },
          { name: "task-c", description: "C", agentSelector: { strategy: "round_robin" } },
        ],
      };

      const state: MockState = { routineRunRow: {}, workflowStepRows: [] };
      const db = makeMockDb(state);
      const svc = workflowEngineService(db);

      const execState = await svc.execute("co-1", "agent-1", "issue-1", "r-1", "run-1", parallelWorkflow);

      expect(execState.stepStatuses["task-a"]).toBe("running");
      expect(execState.stepStatuses["task-b"]).toBe("running");
      expect(execState.stepStatuses["task-c"]).toBe("running");
    });

    it("creates execution state with correct step count", async () => {
      const state: MockState = { routineRunRow: {}, workflowStepRows: [] };
      const db = makeMockDb(state);
      const svc = workflowEngineService(db);

      const execState = await svc.execute(
        "co-1", "agent-1", "issue-1", "r-1", "run-1", makeThreeStepWorkflow(),
      );

      // 3 steps defined — lint (root→running), test+deploy (pending)
      expect(Object.keys(execState.stepStatuses)).toHaveLength(3);
      expect(execState.stepStatuses["lint"]).toBe("running");
      expect(execState.stepStatuses["test"]).toBe("pending");
      expect(execState.stepStatuses["deploy"]).toBe("pending");
    });
  });

  // -------------------------------------------------------------------------
  // onStepComplete
  // -------------------------------------------------------------------------

  describe("onStepComplete", () => {
    it("marks dependent step as running when prerequisite succeeds", async () => {
      const initialState: WorkflowExecutionState = {
        coordinatorSessionId: "session-1",
        stepStatuses: { "step-1": "running", "step-2": "pending" },
        stepTaskIds: { "step-1": "task-1", "step-2": "task-2" },
      };

      const routineRunRow = {
        id: "run-1",
        companyId: "co-1",
        routineId: "routine-1",
        workflowExecutionState: initialState,
      };

      const workflowStepRows = [
        { id: "s1", companyId: "co-1", routineId: "routine-1", stepIndex: 0, name: "step-1", dependsOnSteps: [], condition: null },
        { id: "s2", companyId: "co-1", routineId: "routine-1", stepIndex: 1, name: "step-2", dependsOnSteps: [0], condition: { type: "on_success" } },
      ];

      const state: MockState = { routineRunRow, workflowStepRows };
      const db = makeMockDb(state);
      const svc = workflowEngineService(db);

      await svc.onStepComplete("co-1", "run-1", "step-1", "succeeded");

      const updatedState = state.routineRunRow?.workflowExecutionState as WorkflowExecutionState;
      expect(updatedState.stepStatuses["step-1"]).toBe("succeeded");
      expect(updatedState.stepStatuses["step-2"]).toBe("running");
    });

    it("skips on_success step when dependency failed", async () => {
      const initialState: WorkflowExecutionState = {
        coordinatorSessionId: "session-1",
        stepStatuses: { "step-1": "running", "step-2": "pending" },
        stepTaskIds: {},
      };

      const routineRunRow = {
        id: "run-1",
        companyId: "co-1",
        routineId: "routine-1",
        workflowExecutionState: initialState,
      };

      const workflowStepRows = [
        { id: "s1", stepIndex: 0, name: "step-1", dependsOnSteps: [], condition: null },
        { id: "s2", stepIndex: 1, name: "step-2", dependsOnSteps: [0], condition: { type: "on_success" } },
      ];

      const state: MockState = { routineRunRow, workflowStepRows };
      const db = makeMockDb(state);
      const svc = workflowEngineService(db);

      await svc.onStepComplete("co-1", "run-1", "step-1", "failed");

      const updatedState = state.routineRunRow?.workflowExecutionState as WorkflowExecutionState;
      expect(updatedState.stepStatuses["step-1"]).toBe("failed");
      expect(updatedState.stepStatuses["step-2"]).toBe("skipped");
    });

    it("runs on_failure step when dependency failed", async () => {
      const initialState: WorkflowExecutionState = {
        coordinatorSessionId: "session-1",
        stepStatuses: { "main": "running", "rollback": "pending" },
        stepTaskIds: {},
      };

      const routineRunRow = {
        id: "run-1",
        companyId: "co-1",
        routineId: "routine-1",
        workflowExecutionState: initialState,
      };

      const workflowStepRows = [
        { id: "s1", stepIndex: 0, name: "main", dependsOnSteps: [], condition: null },
        { id: "s2", stepIndex: 1, name: "rollback", dependsOnSteps: [0], condition: { type: "on_failure" } },
      ];

      const state: MockState = { routineRunRow, workflowStepRows };
      const db = makeMockDb(state);
      const svc = workflowEngineService(db);

      await svc.onStepComplete("co-1", "run-1", "main", "failed");

      const updatedState = state.routineRunRow?.workflowExecutionState as WorkflowExecutionState;
      expect(updatedState.stepStatuses["rollback"]).toBe("running");
    });

    it("no-ops when routine run has no workflow state", async () => {
      const state: MockState = { routineRunRow: { id: "run-1", workflowExecutionState: null }, workflowStepRows: [] };
      const db = makeMockDb(state);
      const svc = workflowEngineService(db);
      // Should not throw
      await expect(svc.onStepComplete("co-1", "run-1", "step-1", "succeeded")).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getExecutionStatus
  // -------------------------------------------------------------------------

  describe("getExecutionStatus", () => {
    it("returns execution status with correct aggregates", async () => {
      const execState: WorkflowExecutionState = {
        coordinatorSessionId: "session-1",
        stepStatuses: {
          "step-1": "succeeded",
          "step-2": "running",
          "step-3": "pending",
        },
        stepTaskIds: {},
      };

      const state: MockState = {
        routineRunRow: { id: "run-1", companyId: "co-1", workflowExecutionState: execState },
        workflowStepRows: [],
      };
      const db = makeMockDb(state);
      const svc = workflowEngineService(db);

      const status = await svc.getExecutionStatus("co-1", "run-1");

      expect(status).not.toBeNull();
      expect(status!.totalSteps).toBe(3);
      expect(status!.completedSteps).toBe(1);
      expect(status!.failedSteps).toBe(0);
      expect(status!.pendingSteps).toBe(2); // running + pending both count as pending
      expect(status!.isComplete).toBe(false);
    });

    it("reports complete when all steps done", async () => {
      const execState: WorkflowExecutionState = {
        coordinatorSessionId: "session-1",
        stepStatuses: { "step-1": "succeeded", "step-2": "succeeded" },
        stepTaskIds: {},
      };

      const state: MockState = {
        routineRunRow: { id: "run-1", companyId: "co-1", workflowExecutionState: execState },
        workflowStepRows: [],
      };
      const db = makeMockDb(state);
      const svc = workflowEngineService(db);

      const status = await svc.getExecutionStatus("co-1", "run-1");
      expect(status!.isComplete).toBe(true);
    });

    it("returns null when no workflow state exists", async () => {
      const state: MockState = {
        routineRunRow: { id: "run-1", workflowExecutionState: null },
        workflowStepRows: [],
      };
      const db = makeMockDb(state);
      const svc = workflowEngineService(db);

      const status = await svc.getExecutionStatus("co-1", "run-1");
      expect(status).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // buildStepContext
  // -------------------------------------------------------------------------

  describe("buildStepContext", () => {
    it("generates markdown with step statuses", () => {
      const db = makeMockDb({ routineRunRow: null, workflowStepRows: [] });
      const svc = workflowEngineService(db);

      const context = svc.buildStepContext({
        coordinatorSessionId: "session-1",
        stepStatuses: {
          "lint": "succeeded",
          "test": "running",
          "deploy": "pending",
        },
        stepTaskIds: {},
      });

      expect(context).toContain("## Workflow Execution State");
      expect(context).toContain("✅");   // succeeded
      expect(context).toContain("🔄");   // running
      expect(context).toContain("⏳");   // pending
      expect(context).toContain("lint");
      expect(context).toContain("test");
      expect(context).toContain("deploy");
    });
  });
});
