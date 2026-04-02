import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { routines } from "./routines.js";

/**
 * workflow_steps — Phase 13: Declarative Workflow Engine
 *
 * Stores the step definitions for a multi-agent DAG workflow attached
 * to a Routine. Each step maps to a worker task in the coordinator.
 *
 * Adapted from Claude Code skills/bundled/batch.ts step structure:
 *   - agentSelector: strategy (round_robin / load_balance / capability_match)
 *   - dependsOnSteps: array of stepIndex references (DAG edges)
 *   - condition: on_success / on_failure / always
 */
export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),

    /** Execution order (0-based). */
    stepIndex: integer("step_index").notNull(),

    /** Unique step name within the workflow (e.g. "lint-check"). */
    name: text("name").notNull(),
    description: text("description").notNull().default(""),

    /**
     * Agent selection strategy.
     * { strategy: "round_robin" | "load_balance" | "capability_match", capabilities?: string[] }
     */
    agentSelector: jsonb("agent_selector")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({ strategy: "round_robin" }),

    /**
     * DAG dependency: list of stepIndex values this step waits for.
     * Empty array = root step (runs immediately).
     */
    dependsOnSteps: integer("depends_on_steps")
      .array()
      .notNull()
      .default([]),

    /**
     * Execution condition — when to run this step.
     * { type: "on_success" | "on_failure" | "always" }
     */
    condition: jsonb("condition").$type<{ type: string } | null>(),

    /** PermissionType[] required by this step (Phase 21 integration). */
    requiredPermissions: text("required_permissions").array().notNull().default([]),

    /** MCP server names required by this step (Phase 16 integration). */
    mcpServers: text("mcp_servers").array().notNull().default([]),

    /** Per-step timeout. */
    timeoutMinutes: integer("timeout_minutes").notNull().default(60),

    /** Retry policy: { maxRetries: number, backoffMs: number } */
    retryPolicy: jsonb("retry_policy").$type<{ maxRetries: number; backoffMs: number } | null>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyRoutineStepIdx: index("workflow_steps_company_routine_idx").on(
      table.companyId,
      table.routineId,
      table.stepIndex,
    ),
  }),
);
