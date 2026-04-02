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
import { coordinatorSessions } from "./coordinator_sessions.js";
import type {
  PermissionRequestStatus,
  PermissionType,
  DelegationScope,
} from "@paperclipai/shared";

/**
 * permission_requests — Phase 21: Permission Delegation Protocol
 *
 * Tracks worker→coordinator→user permission escalation requests.
 * Ported from Claude Code swarm/permissionSync.ts Worker→Leader→User flow,
 * adapted to use DB + message bus instead of filesystem.
 *
 * Flow:
 *   1. Worker requests permission for a tool (status: "pending")
 *   2. Coordinator auto-approves or escalates to user
 *   3. Resolution stored here (status: "approved" | "rejected")
 *   4. Message bus notifies worker of outcome
 */
export const permissionRequests = pgTable(
  "permission_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    coordinatorSessionId: uuid("coordinator_session_id")
      .notNull()
      .references(() => coordinatorSessions.id, { onDelete: "cascade" }),

    /** The worker agent making the request. */
    workerAgentId: uuid("worker_agent_id")
      .notNull()
      .references(() => agents.id),

    /** The coordinator agent that resolves or escalates the request (null = user escalated directly). */
    resolverAgentId: uuid("resolver_agent_id").references(() => agents.id),

    /** Human user who resolved the request (set when escalated to user). */
    resolverUserId: text("resolver_user_id"),

    // ── Request content (adapted from Claude Code SwarmPermissionRequest) ──

    /** The tool requiring permission: "Bash", "Edit", "Write", "mcp_tool_use", etc. */
    toolName: text("tool_name").notNull(),

    /** Serialized permission type category. */
    permissionType: text("permission_type").$type<PermissionType>().notNull(),

    /** Human-readable description of what the worker wants to do. */
    description: text("description").notNull(),

    /** The serialized tool input (may be modified by resolver). */
    toolInput: jsonb("tool_input").$type<Record<string, unknown>>().notNull().default({}),

    // ── Resolution ──

    status: text("status")
      .$type<PermissionRequestStatus>()
      .notNull()
      .default("pending"),

    /** Scope of the grant — how long the approval lasts. */
    grantScope: text("grant_scope").$type<DelegationScope>(),

    /** Rejection or modification feedback from the resolver. */
    feedback: text("feedback"),

    /** Modified tool input if the resolver changed the parameters. */
    updatedInput: jsonb("updated_input").$type<Record<string, unknown>>(),

    // ── Timestamps ──

    /** Auto-reject after this time if unresolved (default: 30 min). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companySessionStatusIdx: index(
      "permission_requests_company_session_status_idx",
    ).on(table.companyId, table.coordinatorSessionId, table.status),
    companyWorkerStatusIdx: index(
      "permission_requests_company_worker_status_idx",
    ).on(table.companyId, table.workerAgentId, table.status),
    expiresAtIdx: index("permission_requests_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);
