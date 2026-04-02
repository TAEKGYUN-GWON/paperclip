/**
 * remote-planner.ts
 * Phase 20: ULTRAPLAN Remote Plan Offload — Main Orchestration Service
 *
 * Manages the full lifecycle of a remote planning session:
 *   1. createPlanSession  — creates DB record + starts server-internal polling
 *   2. startPolling       — 3-second interval poll loop (MAX 30 min, 5 failures)
 *   3. pollOnce           — single scan iteration (scan → transition → notify)
 *   4. approvePlan        — user approves → auto-execute (coordinator / workflow / single_agent)
 *   5. rejectPlan         — user rejects → increment rejectCount, feedback → re-planning
 *   6. provideInput       — supply answer to a "## Needs Input:" question
 *   7. cancelPlan         — user cancels session
 *   8. cleanupExpired     — maintenance: expire old sessions
 *
 * Claude Code reference: src/utils/ultraplan/ccrSession.ts + ultraplan.tsx
 *   - pollForApprovedExitPlanMode()  → startPolling() + pollOnce()
 *   - launchUltraplan()              → createPlanSession()
 *   - extractApprovedPlan()          → plan marker parsing in plan-scanner.ts
 *   - Constants: POLL_INTERVAL=3000, TIMEOUT=30min, MAX_FAILURES=5
 *
 * Feature-flagged under "remote_planning".
 */

import { and, eq, lt, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { remotePlanSessions, agents, issues } from "@paperclipai/db";
import type { PlanExecutionTarget, PlanSessionStatus } from "@paperclipai/shared";
import { featureFlagsService } from "./feature-flags.js";
import { planScannerService, type RemotePlanSession } from "./plan-scanner.js";
import { coordinatorService } from "./coordinator.js";
import { messageBusService } from "./message-bus.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types — public API
// ---------------------------------------------------------------------------

export interface CreatePlanRequest {
  companyId: string;
  plannerAgentId: string;
  /** The issue to plan around (provides context to the planner agent). */
  sourceIssueId?: string;
  /** Agent that triggered the plan (null = user-initiated). */
  requestedByAgentId?: string;
  /** User who initiated the plan (null = agent-initiated). */
  requestedByUserId?: string;
  /** How the approved plan should be executed (default: coordinator). */
  executionTarget?: PlanExecutionTarget;
  /** Override session timeout in ms (default 30 min). */
  timeoutMs?: number;
}

export interface ApprovePlanOptions {
  /** User-edited version of the plan text (replaces planText for execution). */
  editedPlan?: string;
  /** Override how the plan will be executed. */
  executionTarget?: PlanExecutionTarget;
}

export interface PlanResult {
  sessionId: string;
  plan: string;
  rejectCount: number;
  executionTarget: PlanExecutionTarget;
  /** Set when executionTarget is "coordinator" and auto-execution started. */
  coordinatorSessionId?: string;
}

// ---------------------------------------------------------------------------
// Constants (Claude Code pollForApprovedExitPlanMode constants)
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000; // 30 minutes
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;
const MAX_REJECT_COUNT = 5;

// ---------------------------------------------------------------------------
// Planning agent system prompt overlay
// Injected by the heartbeat integration point when planningMode is active.
// ---------------------------------------------------------------------------

export const PLANNING_AGENT_SYSTEM_PROMPT = `
You are a planning agent. Your task is to analyze the given issue and produce
a detailed execution plan — NOT to execute it yourself.

Your plan MUST follow this structure:
1. **Analysis**: What the issue requires, key technical decisions
2. **Steps**: Ordered list of concrete work items (each becomes a worker task)
3. **Dependencies**: Which steps depend on others (DAG)
4. **Agent Requirements**: What capabilities each step needs
5. **Risk Assessment**: What could go wrong and mitigations

When you need clarification from the user, output EXACTLY this format:
## Needs Input:
[your question here]

When your plan is complete, output EXACTLY this marker followed by the plan:
## Plan Ready
[your plan in structured YAML or Markdown here]

Do NOT attempt to execute any code or make any changes. Produce ONLY the plan.
`.trim();

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function remotePlannerService(db: Db) {
  const log = logger.child({ service: "remote-planner" });
  const flags = featureFlagsService(db);
  const scanner = planScannerService(db);
  const coordinator = coordinatorService(db);

  /** Active poll interval handles keyed by sessionId. */
  const activePollIntervals = new Map<string, ReturnType<typeof setInterval>>();

  // -------------------------------------------------------------------------
  // Feature flag gate
  // -------------------------------------------------------------------------

  async function isEnabled(): Promise<boolean> {
    return flags.isEnabled("remote_planning");
  }

  // -------------------------------------------------------------------------
  // createPlanSession — Claude Code launchUltraplan() adaptation
  // -------------------------------------------------------------------------

  async function createPlanSession(
    req: CreatePlanRequest,
  ): Promise<RemotePlanSession> {
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const expiresAt = new Date(Date.now() + timeoutMs);

    const [row] = await db
      .insert(remotePlanSessions)
      .values({
        companyId: req.companyId,
        plannerAgentId: req.plannerAgentId,
        sourceIssueId: req.sourceIssueId ?? null,
        requestedByAgentId: req.requestedByAgentId ?? null,
        requestedByUserId: req.requestedByUserId ?? null,
        executionTarget: req.executionTarget ?? "coordinator",
        status: "planning",
        phase: "running",
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
        timeoutMs,
        maxConsecutiveFailures: DEFAULT_MAX_CONSECUTIVE_FAILURES,
        expiresAt,
      })
      .returning();

    const session = row!;

    log.info(
      { sessionId: session.id, companyId: req.companyId, plannerAgentId: req.plannerAgentId },
      "Remote plan session created",
    );

    // Start polling asynchronously
    void startPolling(session.id).catch((err) => {
      log.warn({ sessionId: session.id, err }, "Plan polling startup error (non-fatal)");
    });

    return session;
  }

  // -------------------------------------------------------------------------
  // startPolling — Claude Code pollForApprovedExitPlanMode() adaptation
  //
  // Runs a setInterval loop on the server. On each tick:
  //   1. Call pollOnce() → scan current state
  //   2. On terminal states (approved, failed, expired) → stop polling
  //   3. On needs_input → notify via message bus
  //   4. On consecutive failures ≥ max → mark as failed and stop
  // -------------------------------------------------------------------------

  async function startPolling(sessionId: string): Promise<void> {
    // Prevent duplicate intervals
    if (activePollIntervals.has(sessionId)) return;

    const session = await scanner.getSession(sessionId);
    if (!session) return;

    const intervalId = setInterval(async () => {
      try {
        const result = await pollOnce(sessionId);

        if (
          result.kind === "approved" ||
          result.kind === "failed" ||
          result.kind === "expired"
        ) {
          stopPolling(sessionId);
          return;
        }

        if (result.kind === "plan_ready") {
          // Notify via message bus so the UI and requesting agent know
          const updatedSession = await scanner.getSession(sessionId);
          if (updatedSession?.requestedByAgentId) {
            const msgBus = messageBusService(db);
            await msgBus.send({
              companyId: updatedSession.companyId,
              fromAgentId: updatedSession.plannerAgentId,
              toAgentId: updatedSession.requestedByAgentId,
              mode: "direct",
              type: "notification",
              priority: 0,
              body: JSON.stringify({ type: "plan_ready", sessionId }),
            });
          }
          // Plan is ready — stop polling and wait for user decision
          stopPolling(sessionId);
          return;
        }

        if (result.kind === "needs_input") {
          const updatedSession = await scanner.getSession(sessionId);
          if (updatedSession?.requestedByAgentId) {
            const msgBus = messageBusService(db);
            await msgBus.send({
              companyId: updatedSession.companyId,
              fromAgentId: updatedSession.plannerAgentId,
              toAgentId: updatedSession.requestedByAgentId,
              mode: "direct",
              type: "notification",
              priority: 0,
              body: JSON.stringify({ type: "plan_needs_input", sessionId, question: result.question }),
            });
          }
          // Stop polling until user provides input
          stopPolling(sessionId);
          return;
        }
      } catch (err) {
        const failures = await scanner.incrementConsecutiveFailures(sessionId);
        log.warn({ sessionId, err, failures }, "Poll iteration failed");

        const sess = await scanner.getSession(sessionId);
        if (sess && failures >= (sess.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES)) {
          stopPolling(sessionId);
          await scanner.transition(sessionId, "failed", {
            error: `${failures} consecutive polling failures`,
          });
        }
      }
    }, session.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);

    activePollIntervals.set(sessionId, intervalId);
    log.info({ sessionId }, "Plan polling started");
  }

  function stopPolling(sessionId: string): void {
    const intervalId = activePollIntervals.get(sessionId);
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      activePollIntervals.delete(sessionId);
      log.debug({ sessionId }, "Plan polling stopped");
    }
  }

  // -------------------------------------------------------------------------
  // pollOnce — single poll iteration
  // -------------------------------------------------------------------------

  async function pollOnce(sessionId: string) {
    const result = await scanner.scan(sessionId);
    await scanner.resetConsecutiveFailures(sessionId);
    return result;
  }

  // -------------------------------------------------------------------------
  // approvePlan — user approves plan → trigger execution
  //
  // Adapted from Claude Code "approved" ScanResult handling in ultraplan.tsx.
  // -------------------------------------------------------------------------

  async function approvePlan(
    sessionId: string,
    opts?: ApprovePlanOptions,
  ): Promise<PlanResult> {
    const session = await scanner.getSession(sessionId);
    if (!session) throw new Error(`Plan session ${sessionId} not found`);
    if (session.status !== "plan_ready") {
      throw new Error(`Plan session ${sessionId} is not in plan_ready state (current: ${session.status})`);
    }

    const effectivePlan = opts?.editedPlan ?? session.planText ?? "";
    const executionTarget = opts?.executionTarget ?? session.executionTarget ?? "coordinator";

    // Transition to approved
    await scanner.transition(sessionId, "approved", {
      plan: effectivePlan,
      editedPlan: opts?.editedPlan,
    });

    // Update execution target if overridden
    if (opts?.executionTarget) {
      await db
        .update(remotePlanSessions)
        .set({ executionTarget: opts.executionTarget, updatedAt: new Date() })
        .where(eq(remotePlanSessions.id, sessionId));
    }

    // Transition to executing
    await scanner.transition(sessionId, "executing");

    let coordinatorSessionId: string | undefined;

    try {
      if (executionTarget === "coordinator" && session.sourceIssueId) {
        // Auto-create coordinator session using the planner agent as coordinator
        const coordSession = await coordinator.startCoordination({
          companyId: session.companyId,
          coordinatorAgentId: session.plannerAgentId,
          parentIssueId: session.sourceIssueId,
          config: { fromPlanSessionId: sessionId },
        });
        coordinatorSessionId = coordSession.id;

        // Link coordinator session back to plan session
        await db
          .update(remotePlanSessions)
          .set({ coordinatorSessionId: coordSession.id, updatedAt: new Date() })
          .where(eq(remotePlanSessions.id, sessionId));

        log.info(
          { sessionId, coordinatorSessionId: coordSession.id },
          "Plan approved — coordinator session started",
        );
      } else {
        log.info(
          { sessionId, executionTarget },
          `Plan approved — execution target '${executionTarget}', coordinator auto-start skipped`,
        );
      }

      await scanner.transition(sessionId, "completed");
    } catch (err) {
      log.warn({ sessionId, err }, "Plan execution start failed");
      await scanner.transition(sessionId, "failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const updatedSession = await scanner.getSession(sessionId);

    return {
      sessionId,
      plan: effectivePlan,
      rejectCount: updatedSession?.rejectCount ?? 0,
      executionTarget,
      coordinatorSessionId,
    };
  }

  // -------------------------------------------------------------------------
  // rejectPlan — user rejects → re-planning
  // -------------------------------------------------------------------------

  async function rejectPlan(sessionId: string, feedback: string): Promise<void> {
    const session = await scanner.getSession(sessionId);
    if (!session) throw new Error(`Plan session ${sessionId} not found`);
    if (session.status !== "plan_ready") {
      throw new Error(`Plan session ${sessionId} is not in plan_ready state`);
    }

    const newRejectCount = session.rejectCount + 1;
    if (newRejectCount > MAX_REJECT_COUNT) {
      await scanner.transition(sessionId, "expired", {
        error: "Maximum rejection count reached",
      });
      throw new Error("Plan session expired: maximum rejection count reached");
    }

    // Increment rejectCount + store feedback + revert to planning
    await db
      .update(remotePlanSessions)
      .set({
        rejectCount: newRejectCount,
        userFeedback: feedback,
        planText: null,
        status: "planning",
        phase: "running",
        updatedAt: new Date(),
      })
      .where(eq(remotePlanSessions.id, sessionId));

    // Notify planner agent via message bus so it can re-plan
    if (session.requestedByAgentId) {
      const msgBus = messageBusService(db);
      await msgBus.send({
        companyId: session.companyId,
        fromAgentId: session.requestedByAgentId,
        toAgentId: session.plannerAgentId,
        mode: "direct",
        type: "request",
        priority: 0,
        body: JSON.stringify({ type: "plan_rejected", sessionId, feedback, rejectCount: newRejectCount }),
      });
    }

    // Restart polling
    void startPolling(sessionId).catch((err) => {
      log.warn({ sessionId, err }, "Plan polling restart after rejection failed (non-fatal)");
    });

    log.info({ sessionId, rejectCount: newRejectCount, feedback }, "Plan rejected, re-planning");
  }

  // -------------------------------------------------------------------------
  // provideInput — user answers a needs_input question
  // -------------------------------------------------------------------------

  async function provideInput(sessionId: string, input: string): Promise<void> {
    const session = await scanner.getSession(sessionId);
    if (!session) throw new Error(`Plan session ${sessionId} not found`);
    if (session.status !== "needs_input") {
      throw new Error(`Plan session ${sessionId} is not in needs_input state`);
    }

    // Append the user's answer to planText so the planner can continue
    const userAnswer = `\n\n**User Input:**\n${input}\n`;
    await scanner.appendPlanText(sessionId, userAnswer);

    // Revert to planning state to allow the planner to continue
    await db
      .update(remotePlanSessions)
      .set({
        status: "planning",
        phase: "running",
        pendingQuestion: null,
        updatedAt: new Date(),
      })
      .where(eq(remotePlanSessions.id, sessionId));

    // Notify planner agent with user input
    const msgBus = messageBusService(db);
    await msgBus.send({
      companyId: session.companyId,
      fromAgentId: session.requestedByAgentId ?? session.plannerAgentId,
      toAgentId: session.plannerAgentId,
      mode: "direct",
      type: "response",
      priority: 0,
      body: JSON.stringify({ type: "plan_user_input", sessionId, input }),
    });

    // Restart polling
    void startPolling(sessionId).catch((err) => {
      log.warn({ sessionId, err }, "Plan polling restart after input failed (non-fatal)");
    });

    log.info({ sessionId }, "User input provided, resuming planning");
  }

  // -------------------------------------------------------------------------
  // cancelPlan
  // -------------------------------------------------------------------------

  async function cancelPlan(sessionId: string): Promise<void> {
    stopPolling(sessionId);
    await scanner.transition(sessionId, "cancelled");
    log.info({ sessionId }, "Plan session cancelled");
  }

  // -------------------------------------------------------------------------
  // getSession
  // -------------------------------------------------------------------------

  async function getSession(sessionId: string): Promise<RemotePlanSession | null> {
    return scanner.getSession(sessionId);
  }

  // -------------------------------------------------------------------------
  // listActiveSessions
  // -------------------------------------------------------------------------

  async function listActiveSessions(companyId: string): Promise<RemotePlanSession[]> {
    return db
      .select()
      .from(remotePlanSessions)
      .where(
        and(
          eq(remotePlanSessions.companyId, companyId),
          or(
            eq(remotePlanSessions.status, "planning"),
            eq(remotePlanSessions.status, "needs_input"),
            eq(remotePlanSessions.status, "plan_ready"),
            eq(remotePlanSessions.status, "approved"),
            eq(remotePlanSessions.status, "executing"),
          ),
        ),
      ) as Promise<RemotePlanSession[]>;
  }

  // -------------------------------------------------------------------------
  // getActiveSessionForAgent — called by heartbeat to detect planning mode
  // -------------------------------------------------------------------------

  async function getActiveSessionForAgent(
    agentId: string,
  ): Promise<RemotePlanSession | null> {
    const rows = await db
      .select()
      .from(remotePlanSessions)
      .where(
        and(
          eq(remotePlanSessions.plannerAgentId, agentId),
          or(
            eq(remotePlanSessions.status, "planning"),
            eq(remotePlanSessions.status, "needs_input"),
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // cleanupExpired — Claude Code cleanupOldResolutions() adaptation
  // -------------------------------------------------------------------------

  async function cleanupExpired(): Promise<number> {
    const now = new Date();
    const expiredStatuses: PlanSessionStatus[] = ["planning", "needs_input", "plan_ready"];

    // Mark expired sessions
    const toExpire = await db
      .select({ id: remotePlanSessions.id })
      .from(remotePlanSessions)
      .where(
        and(
          lt(remotePlanSessions.expiresAt, now),
          or(...expiredStatuses.map((s) => eq(remotePlanSessions.status, s))),
        ),
      );

    for (const { id } of toExpire) {
      stopPolling(id);
      await scanner.transition(id, "expired");
    }

    log.info({ count: toExpire.length }, "Expired plan sessions cleaned up");
    return toExpire.length;
  }

  // -------------------------------------------------------------------------
  // teardown — stop all active poll intervals (called on server shutdown)
  // -------------------------------------------------------------------------

  function teardown(): void {
    for (const [sessionId, intervalId] of activePollIntervals.entries()) {
      clearInterval(intervalId);
      log.debug({ sessionId }, "Poll interval cleared on teardown");
    }
    activePollIntervals.clear();
  }

  return {
    isEnabled,
    createPlanSession,
    startPolling,
    pollOnce,
    approvePlan,
    rejectPlan,
    provideInput,
    cancelPlan,
    getSession,
    listActiveSessions,
    getActiveSessionForAgent,
    cleanupExpired,
    teardown,
  };
}

export type RemotePlannerServiceType = ReturnType<typeof remotePlannerService>;
