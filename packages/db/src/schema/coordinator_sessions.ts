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
import type {
  CoordinatorSessionStatus,
  DelegationStrategy,
} from "@paperclipai/shared";

/**
 * coordinator_sessions — Phase 19: Coordinator Mode
 *
 * Tracks an active coordination session where a coordinator agent
 * orchestrates work across multiple worker agents via sub-issues.
 */
export const coordinatorSessions = pgTable(
  "coordinator_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    coordinatorAgentId: uuid("coordinator_agent_id")
      .notNull()
      .references(() => agents.id),
    parentIssueId: uuid("parent_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<CoordinatorSessionStatus>()
      .notNull()
      .default("active"),
    maxParallelWorkers: integer("max_parallel_workers").notNull().default(5),
    delegationStrategy: text("delegation_strategy")
      .$type<DelegationStrategy>()
      .notNull()
      .default("round_robin"),
    /** Arbitrary JSON config for future extension. */
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyCoordinatorIdx: index(
      "coordinator_sessions_company_coordinator_idx",
    ).on(table.companyId, table.coordinatorAgentId),
    companyParentIssueIdx: index(
      "coordinator_sessions_company_parent_issue_idx",
    ).on(table.companyId, table.parentIssueId),
    companyStatusIdx: index("coordinator_sessions_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
