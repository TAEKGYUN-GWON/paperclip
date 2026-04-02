/**
 * workflow-engine.ts
 * Phase 13: Declarative Workflow Engine
 *
 * Extends the existing Routines system with multi-agent DAG pipeline support.
 * A workflow is a directed acyclic graph of steps, each executed by a worker
 * agent via the Coordinator (Phase 19).
 *
 * Adapted from Claude Code skills/bundled/batch.ts 3-Phase orchestration:
 *   Phase 1: Plan — parse + validate workflow DAG
 *   Phase 2: Spawn — delegate all steps as coordinator worker tasks
 *   Phase 3: Track — step completion triggers next ready steps
 *
 * Feature-flagged under "declarative_workflows".
 *
 * Integration points:
 *   - coordinatorService (Phase 19): startCoordination + delegate
 *   - taskGraphService (Phase 12): DAG cycle detection
 *   - permissionDelegationService (Phase 21): per-step permission profiles
 *   - mcpDiscoveryService (Phase 16): per-step MCP server scoping
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { routineRuns, workflowSteps } from "@paperclipai/db";
import { featureFlagsService } from "./feature-flags.js";
import { coordinatorService } from "./coordinator.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types — Workflow definition (the "schema" for workflowDefinition JSONB)
// ---------------------------------------------------------------------------

export type AgentSelectorStrategy = "round_robin" | "load_balance" | "capability_match";

export interface AgentSelector {
  strategy: AgentSelectorStrategy;
  /** Required when strategy = "capability_match" */
  capabilities?: string[];
  /** Pin to specific agent IDs (optional) */
  agentIds?: string[];
}

export type StepConditionType = "on_success" | "on_failure" | "always";

export interface StepCondition {
  type: StepConditionType;
}

export interface WorkflowStepDef {
  /** Unique step name within the workflow (e.g. "lint-check"). */
  name: string;
  description: string;
  agentSelector: AgentSelector;
  /** Step names this step waits for before executing. */
  dependsOn?: string[];
  condition?: StepCondition;
  /** Phase 21 PermissionType[] required by this step. */
  requiredPermissions?: string[];
  /** Phase 16 MCP server names available to this step. */
  mcpServers?: string[];
  timeoutMinutes?: number;
  retryPolicy?: { maxRetries: number; backoffMs: number };
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStepDef[];
}

// ---------------------------------------------------------------------------
// Execution state stored in routine_runs.workflowExecutionState
// ---------------------------------------------------------------------------

export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface WorkflowExecutionState {
  coordinatorSessionId: string;
  stepStatuses: Record<string, StepStatus>;
  /** stepName → workerTaskId for progress tracking */
  stepTaskIds: Record<string, string>;
}

export interface WorkflowExecutionStatus {
  routineRunId: string;
  coordinatorSessionId: string;
  stepStatuses: Record<string, StepStatus>;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  pendingSteps: number;
  isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

export class WorkflowValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "WorkflowValidationError";
  }
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function workflowEngineService(db: Db) {
  const log = logger.child({ service: "workflow-engine" });
  const flags = featureFlagsService(db);
  const coordinator = coordinatorService(db);

  async function isEnabled(): Promise<boolean> {
    return flags.isEnabled("declarative_workflows");
  }

  // -------------------------------------------------------------------------
  // parseAndValidate
  // -------------------------------------------------------------------------

  /**
   * Parse and validate a workflow definition.
   * Performs DFS cycle detection (reuses task-graph logic inline).
   * Adapted from Claude Code batch.ts plan validation + task-graph.ts DFS.
   */
  function parseAndValidate(raw: unknown): WorkflowDefinition {
    if (!raw || typeof raw !== "object") {
      throw new WorkflowValidationError("Workflow definition must be an object");
    }

    const def = raw as Record<string, unknown>;

    if (typeof def.name !== "string" || !def.name.trim()) {
      throw new WorkflowValidationError("Workflow must have a non-empty name");
    }

    if (!Array.isArray(def.steps) || def.steps.length === 0) {
      throw new WorkflowValidationError("Workflow must have at least one step");
    }

    if (def.steps.length > 30) {
      throw new WorkflowValidationError("Workflow cannot exceed 30 steps");
    }

    const steps = def.steps as WorkflowStepDef[];
    const stepNames = new Set<string>();

    for (const step of steps) {
      if (!step.name || typeof step.name !== "string") {
        throw new WorkflowValidationError("Each step must have a non-empty name");
      }
      if (stepNames.has(step.name)) {
        throw new WorkflowValidationError(`Duplicate step name: "${step.name}"`);
      }
      stepNames.add(step.name);

      if (!step.description || typeof step.description !== "string") {
        throw new WorkflowValidationError(`Step "${step.name}" must have a description`);
      }

      if (!step.agentSelector || typeof step.agentSelector !== "object") {
        throw new WorkflowValidationError(`Step "${step.name}" must have an agentSelector`);
      }
    }

    // Validate dependencies reference known steps
    for (const step of steps) {
      for (const dep of step.dependsOn ?? []) {
        if (!stepNames.has(dep)) {
          throw new WorkflowValidationError(
            `Step "${step.name}" depends on unknown step "${dep}"`,
          );
        }
      }
    }

    // DFS cycle detection (adapted from task-graph.ts)
    if (hasCycle(steps)) {
      throw new WorkflowValidationError("Workflow DAG contains a cycle");
    }

    return {
      name: def.name,
      description: typeof def.description === "string" ? def.description : undefined,
      steps,
    };
  }

  /** DFS cycle detection on workflow step DAG */
  function hasCycle(steps: WorkflowStepDef[]): boolean {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>(steps.map((s) => [s.name, WHITE]));

    function dfs(name: string): boolean {
      color.set(name, GRAY);
      const step = steps.find((s) => s.name === name);
      for (const dep of step?.dependsOn ?? []) {
        const c = color.get(dep);
        if (c === GRAY) return true; // back-edge = cycle
        if (c === WHITE && dfs(dep)) return true;
      }
      color.set(name, BLACK);
      return false;
    }

    for (const step of steps) {
      if (color.get(step.name) === WHITE && dfs(step.name)) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  /**
   * Execute a workflow:
   *   1. Validate & parse definition
   *   2. Persist step definitions to workflow_steps table
   *   3. Create coordinator session
   *   4. Delegate all steps as worker tasks (root steps immediately, rest pending)
   *   5. Persist initial execution state to routine_runs.workflowExecutionState
   *
   * Adapted from Claude Code batch.ts Phase 2: spawn workers.
   */
  async function execute(
    companyId: string,
    coordinatorAgentId: string,
    parentIssueId: string,
    routineId: string,
    routineRunId: string,
    definition: WorkflowDefinition,
  ): Promise<WorkflowExecutionState> {
    if (!(await isEnabled())) {
      throw new Error("declarative_workflows feature flag is not enabled");
    }

    // Map step name → index for dependency resolution
    const stepIndexByName = new Map<string, number>(
      definition.steps.map((s, i) => [s.name, i]),
    );

    // Persist step definitions
    if (definition.steps.length > 0) {
      await db.insert(workflowSteps).values(
        definition.steps.map((step, i) => ({
          companyId,
          routineId,
          stepIndex: i,
          name: step.name,
          description: step.description,
          agentSelector: step.agentSelector as unknown as Record<string, unknown>,
          dependsOnSteps: (step.dependsOn ?? []).map((dep) => stepIndexByName.get(dep) ?? -1).filter((idx) => idx >= 0),
          condition: step.condition ?? null,
          requiredPermissions: step.requiredPermissions ?? [],
          mcpServers: step.mcpServers ?? [],
          timeoutMinutes: step.timeoutMinutes ?? 60,
          retryPolicy: step.retryPolicy ?? null,
        })),
      );
    }

    // Create coordinator session
    const session = await coordinator.startCoordination({
      companyId,
      coordinatorAgentId,
      parentIssueId,
      delegationStrategy: "round_robin",
    });

    // Build delegation plan — all steps as tasks
    // Claude Code batch.ts: spawn each work unit with independence
    const tasks = definition.steps.map((step, i) => ({
      title: step.name,
      description: `[Workflow step ${i + 1}/${definition.steps.length}] ${step.description}`,
      assignToAgentId: step.agentSelector.agentIds?.[0] ?? null,
      dependsOnTaskIndices: (step.dependsOn ?? [])
        .map((dep) => stepIndexByName.get(dep) ?? -1)
        .filter((idx) => idx >= 0),
    }));

    const workerTaskList = await coordinator.delegate(companyId, session.id, { tasks });

    // Build initial execution state
    const stepStatuses: Record<string, StepStatus> = {};
    const stepTaskIds: Record<string, string> = {};

    for (let i = 0; i < definition.steps.length; i++) {
      const stepName = definition.steps[i]!.name;
      const task = workerTaskList[i];
      stepStatuses[stepName] = "pending";
      if (task) stepTaskIds[stepName] = task.id;
    }

    // Mark root steps (no dependencies) as running
    for (const step of definition.steps) {
      if ((step.dependsOn ?? []).length === 0) {
        stepStatuses[step.name] = "running";
      }
    }

    const executionState: WorkflowExecutionState = {
      coordinatorSessionId: session.id,
      stepStatuses,
      stepTaskIds,
    };

    // Persist to routine_run
    await db
      .update(routineRuns)
      .set({
        workflowExecutionState: executionState as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(routineRuns.id, routineRunId),
          eq(routineRuns.companyId, companyId),
        ),
      );

    log.info(
      {
        companyId,
        routineId,
        routineRunId,
        sessionId: session.id,
        stepCount: definition.steps.length,
      },
      "Workflow execution started",
    );

    return executionState;
  }

  // -------------------------------------------------------------------------
  // onStepComplete
  // -------------------------------------------------------------------------

  /**
   * Called when a worker task completes.
   * Updates step status and marks next steps as ready based on condition.
   *
   * Adapted from Claude Code batch.ts Phase 3: track + trigger next.
   */
  async function onStepComplete(
    companyId: string,
    routineRunId: string,
    stepName: string,
    outcome: "succeeded" | "failed",
  ): Promise<void> {
    const runRows = await db
      .select()
      .from(routineRuns)
      .where(
        and(
          eq(routineRuns.id, routineRunId),
          eq(routineRuns.companyId, companyId),
        ),
      )
      .limit(1);

    const run = runRows[0];
    if (!run?.workflowExecutionState) {
      log.warn({ routineRunId, stepName }, "No workflow execution state found, skipping");
      return;
    }

    const state = run.workflowExecutionState as unknown as WorkflowExecutionState;
    state.stepStatuses[stepName] = outcome;

    // Load step definitions to determine which steps are now unblocked
    const stepDefs = await db
      .select()
      .from(workflowSteps)
      .where(
        and(
          eq(workflowSteps.companyId, companyId),
          eq(workflowSteps.routineId, run.routineId),
        ),
      );

    const stepDefByName = new Map(stepDefs.map((s) => [s.name, s]));

    // Check which pending steps are now unblocked
    for (const [sName, sStatus] of Object.entries(state.stepStatuses)) {
      if (sStatus !== "pending") continue;

      const def = stepDefByName.get(sName);
      if (!def) continue;

      // Check if all dependencies are complete
      const deps = def.dependsOnSteps ?? [];
      const allDepsComplete = deps.every((depIdx) => {
        const depDef = stepDefs.find((s) => s.stepIndex === depIdx);
        if (!depDef) return true;
        const depStatus = state.stepStatuses[depDef.name];
        return depStatus === "succeeded" || depStatus === "failed" || depStatus === "skipped";
      });

      if (!allDepsComplete) continue;

      // Apply step condition
      const condition = def.condition as { type?: string } | null;
      const condType: StepConditionType = (condition?.type as StepConditionType) ?? "on_success";

      // Check if the triggering step's deps satisfied this step's condition
      const depStatuses = deps.map((depIdx) => {
        const depDef = stepDefs.find((s) => s.stepIndex === depIdx);
        return depDef ? (state.stepStatuses[depDef.name] ?? "pending") : ("succeeded" as StepStatus);
      });

      const anyFailed = depStatuses.some((s) => s === "failed");
      const shouldRun =
        condType === "always" ||
        (condType === "on_success" && !anyFailed) ||
        (condType === "on_failure" && anyFailed);

      state.stepStatuses[sName] = shouldRun ? "running" : "skipped";
    }

    // Persist updated state
    await db
      .update(routineRuns)
      .set({
        workflowExecutionState: state as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(routineRuns.id, routineRunId));

    // Check if workflow is complete
    const allDone = Object.values(state.stepStatuses).every(
      (s) => s === "succeeded" || s === "failed" || s === "skipped",
    );

    if (allDone) {
      const anyFailed = Object.values(state.stepStatuses).some((s) => s === "failed");
      log.info(
        { routineRunId, succeeded: !anyFailed },
        "Workflow execution complete",
      );
    }
  }

  // -------------------------------------------------------------------------
  // getExecutionStatus
  // -------------------------------------------------------------------------

  async function getExecutionStatus(
    companyId: string,
    routineRunId: string,
  ): Promise<WorkflowExecutionStatus | null> {
    const runRows = await db
      .select()
      .from(routineRuns)
      .where(
        and(
          eq(routineRuns.id, routineRunId),
          eq(routineRuns.companyId, companyId),
        ),
      )
      .limit(1);

    const run = runRows[0];
    if (!run?.workflowExecutionState) return null;

    const state = run.workflowExecutionState as unknown as WorkflowExecutionState;
    const statuses = state.stepStatuses;
    const total = Object.keys(statuses).length;
    const completed = Object.values(statuses).filter(
      (s) => s === "succeeded" || s === "skipped",
    ).length;
    const failed = Object.values(statuses).filter((s) => s === "failed").length;
    const pending = Object.values(statuses).filter(
      (s) => s === "pending" || s === "running",
    ).length;

    return {
      routineRunId,
      coordinatorSessionId: state.coordinatorSessionId,
      stepStatuses: statuses,
      totalSteps: total,
      completedSteps: completed,
      failedSteps: failed,
      pendingSteps: pending,
      isComplete: pending === 0,
    };
  }

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  async function cancel(companyId: string, routineRunId: string): Promise<void> {
    const runRows = await db
      .select()
      .from(routineRuns)
      .where(
        and(
          eq(routineRuns.id, routineRunId),
          eq(routineRuns.companyId, companyId),
        ),
      )
      .limit(1);

    const run = runRows[0];
    if (!run?.workflowExecutionState) return;

    const state = run.workflowExecutionState as unknown as WorkflowExecutionState;

    // Cancel coordinator session
    await coordinator.cancelSession(companyId, state.coordinatorSessionId);

    // Mark all pending/running steps as failed
    for (const [name, status] of Object.entries(state.stepStatuses)) {
      if (status === "pending" || status === "running") {
        state.stepStatuses[name] = "failed";
      }
    }

    await db
      .update(routineRuns)
      .set({
        workflowExecutionState: state as unknown as Record<string, unknown>,
        status: "failed",
        failureReason: "Workflow cancelled",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(routineRuns.id, routineRunId));

    log.info({ routineRunId }, "Workflow cancelled");
  }

  // -------------------------------------------------------------------------
  // buildStepContext
  // -------------------------------------------------------------------------

  /**
   * Build a markdown summary of the workflow execution state for heartbeat injection.
   * Phase 13: inject into coordinator context so it knows the pipeline state.
   */
  function buildStepContext(state: WorkflowExecutionState): string {
    const lines = ["## Workflow Execution State", ""];
    for (const [stepName, status] of Object.entries(state.stepStatuses)) {
      const icon =
        status === "succeeded" ? "✅" :
        status === "failed" ? "❌" :
        status === "running" ? "🔄" :
        status === "skipped" ? "⏭" : "⏳";
      lines.push(`- ${icon} **${stepName}**: ${status}`);
    }
    return lines.join("\n");
  }

  return {
    isEnabled,
    parseAndValidate,
    execute,
    onStepComplete,
    getExecutionStatus,
    cancel,
    buildStepContext,
  };
}

export type WorkflowEngineServiceType = ReturnType<typeof workflowEngineService>;
