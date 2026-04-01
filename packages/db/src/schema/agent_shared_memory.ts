import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * agent_shared_memory — Phase 18: Message Bus (shared memory component)
 *
 * Company-scoped key-value store accessible by all agents within the company.
 * Agents use namespace isolation to avoid key collisions.
 * Supports optional TTL-based expiry.
 */
export const agentSharedMemory = pgTable(
  "agent_shared_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    namespace: text("namespace").notNull().default("default"),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>(),
    authorAgentId: uuid("author_agent_id").references(() => agents.id),
    ttlSeconds: integer("ttl_seconds"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Unique per (company, namespace, key) — upsert target
    companyNamespaceKeyIdx: uniqueIndex("agent_shared_memory_company_ns_key_uq").on(
      table.companyId,
      table.namespace,
      table.key,
    ),
    // For expiry cleanup jobs
    expiresAtIdx: index("agent_shared_memory_expires_at_idx").on(table.expiresAt),
    // For listing all keys in a namespace
    companyNamespaceIdx: index("agent_shared_memory_company_ns_idx").on(
      table.companyId,
      table.namespace,
    ),
  }),
);
