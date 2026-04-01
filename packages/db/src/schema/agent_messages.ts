import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { AgentMessageMode, AgentMessageType, AgentMessageStatus } from "@paperclipai/shared";

/**
 * agent_messages — Phase 18: Message Bus
 *
 * Persistent store for structured agent-to-agent messages.
 * Supports direct, broadcast, and team-scoped delivery modes
 * with now/next/later priority levels (Claude Code pattern port).
 */
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    fromAgentId: uuid("from_agent_id").notNull().references(() => agents.id),
    // null = broadcast to all agents in company
    toAgentId: uuid("to_agent_id").references(() => agents.id),
    mode: text("mode").$type<AgentMessageMode>().notNull().default("direct"),
    // 0 = now (urgent), 1 = next (normal), 2 = later (background)
    priority: integer("priority").notNull().default(1),
    type: text("type").$type<AgentMessageType>().notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    // Optional thread/reply chain linkage
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => agentMessages.id),
    status: text("status").$type<AgentMessageStatus>().notNull().default("queued"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // For recipient inbox queries: "give me all queued messages for agent X"
    toAgentStatusIdx: index("agent_messages_to_agent_status_idx").on(
      table.toAgentId,
      table.status,
      table.createdAt,
    ),
    // For sender outbox queries
    fromAgentIdx: index("agent_messages_from_agent_idx").on(
      table.fromAgentId,
      table.createdAt,
    ),
    // For broadcast queries: "all unread broadcasts in company"
    companyModeStatusIdx: index("agent_messages_company_mode_status_idx").on(
      table.companyId,
      table.mode,
      table.status,
    ),
    // For expiry cleanup jobs
    expiresAtIdx: index("agent_messages_expires_at_idx").on(table.expiresAt),
  }),
);
