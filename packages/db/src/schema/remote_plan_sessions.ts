import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { coordinatorSessions } from "./coordinator_sessions.js";
import type {
  PlanSessionStatus,
  PlanPhase,
  PlanExecutionTarget,
} from "@paperclipai/shared";

/**
 * remote_plan_sessions — Phase 20: ULTRAPLAN Remote Plan Offload
 *
 * Tracks a remote planning session where a dedicated planning agent
 * analyzes a complex issue and produces an executable workflow plan.
 * User reviews / approves / rejects the plan before automatic execution.
 *
 * Adapted from Claude Code utils/ultraplan/ccrSession.ts:
 *   - CCR (Cloud Container Runtime) → Paperclip coordinator agent
 *   - File-system state (pending/ → resolved/) → DB status column
 *   - pollForApprovedExitPlanMode() → server-internal setInterval polling
 *   - ExitPlanModeScanner → planScannerService (plan-scanner.ts)
 */
export const remotePlanSessions = pgTable(
  "remote_plan_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),

    // ── Request context ──

    /** Agent that triggered the plan request (null = user-initiated). */
    requestedByAgentId: uuid("requested_by_agent_id").references(() => agents.id),
    /** Human user who created the plan session (null = agent-initiated). */
    requestedByUserId: text("requested_by_user_id"),
    /** The issue being planned (source of context for the planner agent). */
    sourceIssueId: uuid("source_issue_id").references(() => issues.id, {
      onDelete: "set null",
    }),

    // ── Planning agent ──

    /** Dedicated agent responsible for producing the plan. */
    plannerAgentId: uuid("planner_agent_id")
      .notNull()
      .references(() => agents.id),

    // ── State machine (ExitPlanModeScanner DB adaptation) ──

    /**
     * Current lifecycle status.
     * planning → needs_input → plan_ready → approved → executing → completed | failed
     * Also: expired, cancelled
     */
    status: text("status")
      .$type<PlanSessionStatus>()
      .notNull()
      .default("planning"),

    /**
     * UI-facing phase summary (Claude Code UltraplanPhase adaptation).
     * Derived from status: "running" | "needs_input" | "plan_ready"
     */
    phase: text("phase").$type<PlanPhase>().notNull().default("running"),

    // ── Plan content ──

    /** Raw plan text produced by the planning agent (Markdown). */
    planText: text("plan_text"),
    /** Parsed workflow definition (WorkflowDefinition JSON). */
    planWorkflow: jsonb("plan_workflow").$type<Record<string, unknown>>(),
    /** User-edited version of the plan (set when approved with edits). */
    editedPlan: text("edited_plan"),
    /** User feedback when rejecting the plan (used for re-planning). */
    userFeedback: text("user_feedback"),
    /** Question the planner agent needs answered (status: needs_input). */
    pendingQuestion: text("pending_question"),

    // ── Execution linkage ──

    /** How the approved plan will be executed. */
    executionTarget: text("execution_target").$type<PlanExecutionTarget>(),
    /** Coordinator session created when the plan is approved (if target = coordinator). */
    coordinatorSessionId: uuid("coordinator_session_id").references(
      () => coordinatorSessions.id,
    ),
    /** Routine run ID for workflow-based execution (if target = workflow). */
    routineRunId: text("routine_run_id"),

    // ── Polling / timeout config (from Claude Code constants) ──

    /** Poll interval in milliseconds (default: 3 seconds). */
    pollIntervalMs: integer("poll_interval_ms").notNull().default(3000),
    /** Session timeout in milliseconds (default: 30 minutes). */
    timeoutMs: integer("timeout_ms").notNull().default(1_800_000),
    /** Max consecutive polling failures before aborting (default: 5). */
    maxConsecutiveFailures: integer("max_consecutive_failures").notNull().default(5),

    // ── Runtime counters ──

    /** Number of times the user has rejected this plan (triggers re-planning). */
    rejectCount: integer("reject_count").notNull().default(0),
    /** Current consecutive polling failure count. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),

    // ── Timestamps ──

    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Auto-expires at createdAt + timeoutMs. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("remote_plan_sessions_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    companyRequestedByAgentIdx: index(
      "remote_plan_sessions_company_requested_by_agent_idx",
    ).on(table.companyId, table.requestedByAgentId),
    plannerAgentStatusIdx: index(
      "remote_plan_sessions_planner_agent_status_idx",
    ).on(table.plannerAgentId, table.status),
    expiresAtIdx: index("remote_plan_sessions_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);
