import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { coordinatorSessions } from "./coordinator_sessions.js";
import type { WorkerTaskStatus } from "@paperclipai/shared";

/**
 * worker_tasks — Phase 19: Coordinator Mode
 *
 * Tracks individual work units delegated by a coordinator session
 * to worker agents. Each worker task maps to a sub-issue.
 */
export const workerTasks = pgTable(
  "worker_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    coordinatorSessionId: uuid("coordinator_session_id")
      .notNull()
      .references(() => coordinatorSessions.id, { onDelete: "cascade" }),
    parentIssueId: uuid("parent_issue_id")
      .notNull()
      .references(() => issues.id),
    /** The sub-issue created for this worker task. */
    subIssueId: uuid("sub_issue_id").references(() => issues.id, {
      onDelete: "set null",
    }),
    workerAgentId: uuid("worker_agent_id").references(() => agents.id),
    status: text("status")
      .$type<WorkerTaskStatus>()
      .notNull()
      .default("pending"),
    /** Human-readable summary of what the worker should do. */
    summary: text("summary"),
    /** Structured result returned by the worker upon completion. */
    result: jsonb("result").$type<Record<string, unknown>>(),
    delegatedAt: timestamp("delegated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companySessionIdx: index("worker_tasks_company_session_idx").on(
      table.companyId,
      table.coordinatorSessionId,
    ),
    companyParentIssueStatusIdx: index(
      "worker_tasks_company_parent_issue_status_idx",
    ).on(table.companyId, table.parentIssueId, table.status),
    companyWorkerStatusIdx: index("worker_tasks_company_worker_status_idx").on(
      table.companyId,
      table.workerAgentId,
      table.status,
    ),
  }),
);
