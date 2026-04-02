import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import type { McpTransportType, McpServerStatus, McpServerScope } from "@paperclipai/shared";

/**
 * mcp_servers — Phase 16: MCP Dynamic Tool Registration
 *
 * Persists MCP (Model Context Protocol) server configurations.
 * Adapted from Claude Code services/mcp/types.ts McpServerConfig pattern.
 *
 * Scope hierarchy (narrowest wins for tool visibility):
 *   "company"  → all agents in the company
 *   "project"  → agents working on a specific project
 *   "agent"    → a single agent only
 */
export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),

    /** Human-friendly identifier (unique within company). */
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),

    /** Who can see this server's tools. */
    scope: text("scope").$type<McpServerScope>().notNull().default("company"),
    /** Set when scope is "project" or "agent" — references the relevant entity UUID. */
    scopeId: uuid("scope_id"),

    /** Connection transport type. */
    transportType: text("transport_type")
      .$type<McpTransportType>()
      .notNull()
      .default("http"),

    /**
     * Transport-specific connection config (JSON).
     * HTTP/SSE: { url: string, headers?: Record<string,string> }
     * Stdio:    { command: string, args?: string[], env?: Record<string,string> }
     */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),

    /** Lifecycle status. */
    status: text("status").$type<McpServerStatus>().notNull().default("active"),

    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyNameUqIdx: index("mcp_servers_company_name_uq_idx").on(
      table.companyId,
      table.name,
    ),
    companyScopeScopeIdIdx: index("mcp_servers_company_scope_idx").on(
      table.companyId,
      table.scope,
      table.scopeId,
    ),
    companyStatusIdx: index("mcp_servers_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
