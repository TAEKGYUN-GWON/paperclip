/**
 * plan-scanner.ts
 * Phase 20: ULTRAPLAN Remote Plan Offload — Plan State Machine
 *
 * DB-backed adaptation of Claude Code's ExitPlanModeScanner:
 *   - Analyzes planner-agent output to detect plan completion markers
 *   - Drives the remote_plan_sessions status state machine
 *   - Provides a UI-facing `derivePhase()` helper (≈ UltraplanPhase)
 *
 * Claude Code reference: src/utils/ultraplan/ccrSession.ts
 *   - ExitPlanModeScanner.ingest() → scan()
 *   - hasPendingPlan → "plan_ready" status
 *   - ScanResult kinds: approved / rejected / pending / needs_input / planning / expired / failed
 *
 * The marker-based detection:
 *   "## Plan Ready" in the planner agent's last heartbeat output
 *   triggers a "plan_ready" transition. Absence → still "planning".
 *   "## Needs Input:" prefix signals a clarification request.
 */

import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { remotePlanSessions } from "@paperclipai/db";
import type { PlanSessionStatus, PlanPhase } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScanResultKind =
  | "planning"     // Agent still working — no completion marker found
  | "needs_input"  // Agent is blocked, needs user clarification
  | "plan_ready"   // "## Plan Ready" marker detected
  | "approved"     // User has approved the plan
  | "rejected"     // User has rejected the plan
  | "expired"      // Session timeout reached
  | "failed"       // Unrecoverable failure
  | "unchanged";   // Status unchanged since last poll

export type ScanResult =
  | { kind: "planning" }
  | { kind: "needs_input"; question: string }
  | { kind: "plan_ready"; plan: string }
  | { kind: "approved"; plan: string; editedPlan?: string }
  | { kind: "rejected"; feedback: string }
  | { kind: "expired" }
  | { kind: "failed"; error: string }
  | { kind: "unchanged" };

export type RemotePlanSession = typeof remotePlanSessions.$inferSelect;

// ---------------------------------------------------------------------------
// Marker constants (adapted from Claude Code exitPlanMode markers)
// ---------------------------------------------------------------------------

/** Planner agent outputs this marker when the plan is complete. */
const PLAN_READY_MARKER = "## Plan Ready";

/** Planner agent outputs this prefix when clarification is needed. */
const NEEDS_INPUT_MARKER = "## Needs Input:";

// ---------------------------------------------------------------------------
// planScannerService
// ---------------------------------------------------------------------------

export function planScannerService(db: Db) {
  const log = logger.child({ service: "plan-scanner" });

  // -------------------------------------------------------------------------
  // Retrieve session
  // -------------------------------------------------------------------------

  async function getSession(sessionId: string): Promise<RemotePlanSession | null> {
    const rows = await db
      .select()
      .from(remotePlanSessions)
      .where(eq(remotePlanSessions.id, sessionId))
      .limit(1);
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Scan: analyse current session state to produce a ScanResult
  //
  // Claude Code ExitPlanModeScanner.ingest() adaptation.
  // The scanner does NOT call the LLM — it reads the persisted planText from
  // the DB (written by the heartbeat integration point) and checks for markers.
  // -------------------------------------------------------------------------

  async function scan(sessionId: string): Promise<ScanResult> {
    const session = await getSession(sessionId);
    if (!session) {
      return { kind: "failed", error: `Plan session ${sessionId} not found` };
    }

    const now = new Date();

    // Terminal status shortcuts
    if (session.status === "approved") {
      return {
        kind: "approved",
        plan: session.planText ?? "",
        editedPlan: session.editedPlan ?? undefined,
      };
    }
    if (session.status === "rejected") {
      return { kind: "rejected", feedback: session.userFeedback ?? "" };
    }
    if (session.status === "expired" || session.expiresAt <= now) {
      if (session.status !== "expired") {
        await transition(sessionId, "expired");
      }
      return { kind: "expired" };
    }
    if (session.status === "failed") {
      return { kind: "failed", error: "Plan session failed" };
    }
    if (session.status === "cancelled") {
      return { kind: "failed", error: "Plan session cancelled" };
    }
    if (session.status === "executing" || session.status === "completed") {
      return { kind: "unchanged" };
    }

    // Active planning: inspect planText for markers
    const planText = session.planText ?? "";

    if (planText.includes(PLAN_READY_MARKER)) {
      // Extract the plan body after the marker
      const markerIndex = planText.indexOf(PLAN_READY_MARKER);
      const planBody = planText.slice(markerIndex + PLAN_READY_MARKER.length).trim();
      if (session.status !== "plan_ready") {
        await transition(sessionId, "plan_ready", { plan: planBody || planText });
      }
      return { kind: "plan_ready", plan: planBody || planText };
    }

    if (planText.includes(NEEDS_INPUT_MARKER)) {
      // Extract the question after the marker
      const markerIndex = planText.indexOf(NEEDS_INPUT_MARKER);
      const question = planText.slice(markerIndex + NEEDS_INPUT_MARKER.length).trim();
      const firstLine = question.split("\n")[0]?.trim() ?? question;
      if (session.status !== "needs_input") {
        await transition(sessionId, "needs_input");
      }
      return { kind: "needs_input", question: firstLine };
    }

    return { kind: "planning" };
  }

  // -------------------------------------------------------------------------
  // Transition: drive the state machine and update DB
  // -------------------------------------------------------------------------

  async function transition(
    sessionId: string,
    newStatus: PlanSessionStatus,
    data?: {
      plan?: string;
      feedback?: string;
      error?: string;
      editedPlan?: string;
      question?: string;
    },
  ): Promise<void> {
    const update: Record<string, unknown> = {
      status: newStatus,
      phase: derivePhaseFromStatus(newStatus),
      updatedAt: new Date(),
    };

    if (data?.plan !== undefined) update.planText = data.plan;
    if (data?.editedPlan !== undefined) update.editedPlan = data.editedPlan;
    if (data?.feedback !== undefined) update.userFeedback = data.feedback;
    if (data?.question !== undefined) update.pendingQuestion = data.question;

    if (newStatus === "approved") update.approvedAt = new Date();
    if (newStatus === "completed" || newStatus === "failed" || newStatus === "expired") {
      update.completedAt = new Date();
    }

    await db
      .update(remotePlanSessions)
      .set(update)
      .where(eq(remotePlanSessions.id, sessionId));

    log.info({ sessionId, newStatus }, "Plan session state transition");
  }

  // -------------------------------------------------------------------------
  // derivePhase: map PlanSessionStatus → PlanPhase (for UI display)
  // Adapted from Claude Code UltraplanPhase derivation logic.
  // -------------------------------------------------------------------------

  function derivePhaseFromStatus(status: PlanSessionStatus): PlanPhase {
    switch (status) {
      case "needs_input":
        return "needs_input";
      case "plan_ready":
      case "approved":
        return "plan_ready";
      default:
        return "running";
    }
  }

  function derivePhase(session: RemotePlanSession): PlanPhase {
    return derivePhaseFromStatus(session.status);
  }

  // -------------------------------------------------------------------------
  // appendPlanText: called by heartbeat to append planner output incrementally
  // -------------------------------------------------------------------------

  async function appendPlanText(
    sessionId: string,
    chunk: string,
  ): Promise<void> {
    const session = await getSession(sessionId);
    if (!session) return;
    const current = session.planText ?? "";
    await db
      .update(remotePlanSessions)
      .set({
        planText: current + chunk,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(remotePlanSessions.id, sessionId),
          eq(remotePlanSessions.companyId, session.companyId),
        ),
      );
  }

  // -------------------------------------------------------------------------
  // incrementConsecutiveFailures: used by polling loop error handling
  // -------------------------------------------------------------------------

  async function incrementConsecutiveFailures(sessionId: string): Promise<number> {
    const session = await getSession(sessionId);
    if (!session) return 0;
    const next = session.consecutiveFailures + 1;
    await db
      .update(remotePlanSessions)
      .set({ consecutiveFailures: next, updatedAt: new Date() })
      .where(eq(remotePlanSessions.id, sessionId));
    return next;
  }

  async function resetConsecutiveFailures(sessionId: string): Promise<void> {
    await db
      .update(remotePlanSessions)
      .set({ consecutiveFailures: 0, lastPolledAt: new Date(), updatedAt: new Date() })
      .where(eq(remotePlanSessions.id, sessionId));
  }

  return {
    scan,
    transition,
    derivePhase,
    getSession,
    appendPlanText,
    incrementConsecutiveFailures,
    resetConsecutiveFailures,
  };
}

export type PlanScannerServiceType = ReturnType<typeof planScannerService>;
