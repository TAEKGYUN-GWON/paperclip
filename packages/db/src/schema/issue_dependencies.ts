import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import type { IssueDependencyKind } from "@paperclipai/shared";

/**
 * issue_dependencies — Phase 12: Task Graph
 *
 * Directed dependency edges between issues.
 * Edge semantics: `issueId` cannot start/complete until `dependsOnIssueId` is done.
 *
 * kind:
 *   - "blocks"       : dependsOnId must be done before issueId can start
 *   - "is_blocked_by": alias perspective (same edge, stored as "blocks")
 *   - "relates_to"   : soft link, no blocking semantics
 */
export const issueDependencies = pgTable(
  "issue_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    /** The issue that is waiting. */
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    /** The issue that must finish first. */
    dependsOnIssueId: uuid("depends_on_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    kind: text("kind").$type<IssueDependencyKind>().notNull().default("blocks"),
    createdByAgentId: uuid("created_by_agent_id"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Prevent duplicate edges
    uniqueEdgeIdx: uniqueIndex("issue_dependencies_unique_edge_idx").on(
      table.issueId,
      table.dependsOnIssueId,
      table.kind,
    ),
    // Fast lookup: "what does this issue depend on?"
    issueIdx: index("issue_dependencies_issue_idx").on(table.issueId),
    // Fast lookup: "what issues are blocked by this one?"
    dependsOnIdx: index("issue_dependencies_depends_on_idx").on(table.dependsOnIssueId),
    // Company-scoped queries
    companyIdx: index("issue_dependencies_company_idx").on(table.companyId),
  }),
);
