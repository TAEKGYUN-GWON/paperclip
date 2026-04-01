/**
 * shared-memory.ts
 * Phase 18: Agent Message Bus — Shared Memory component
 *
 * Company-scoped key-value store accessible by all agents.
 * Agents use namespace isolation to avoid key collisions.
 * Supports optional TTL-based expiry.
 */

import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentSharedMemory } from "@paperclipai/db";

export type SharedMemoryEntry = typeof agentSharedMemory.$inferSelect;

export interface SetMemoryOptions {
  /** Author agent ID for audit trail */
  authorAgentId?: string;
  /** Time-to-live in seconds. null = no expiry */
  ttlSeconds?: number | null;
}

export interface ListMemoryOptions {
  limit?: number;
  offset?: number;
  includeExpired?: boolean;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function sharedMemoryService(db: Db) {
  /**
   * Write a value. Creates or updates (upsert) the entry for the given key.
   */
  async function set(
    companyId: string,
    namespace: string,
    key: string,
    value: unknown,
    opts: SetMemoryOptions = {},
  ): Promise<SharedMemoryEntry> {
    const now = new Date();
    const expiresAt =
      opts.ttlSeconds != null
        ? new Date(now.getTime() + opts.ttlSeconds * 1_000)
        : null;

    const [entry] = await db
      .insert(agentSharedMemory)
      .values({
        companyId,
        namespace,
        key,
        value,
        authorAgentId: opts.authorAgentId ?? null,
        ttlSeconds: opts.ttlSeconds ?? null,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [agentSharedMemory.companyId, agentSharedMemory.namespace, agentSharedMemory.key],
        set: {
          value,
          authorAgentId: opts.authorAgentId ?? null,
          ttlSeconds: opts.ttlSeconds ?? null,
          expiresAt,
          updatedAt: now,
        },
      })
      .returning();

    if (!entry) throw new Error("Failed to upsert shared memory entry");
    return entry;
  }

  /**
   * Read a value by key. Returns null if not found or expired.
   */
  async function get(
    companyId: string,
    namespace: string,
    key: string,
  ): Promise<unknown | null> {
    const now = new Date();

    const [entry] = await db
      .select()
      .from(agentSharedMemory)
      .where(
        and(
          eq(agentSharedMemory.companyId, companyId),
          eq(agentSharedMemory.namespace, namespace),
          eq(agentSharedMemory.key, key),
          // Exclude expired entries
          sql`${agentSharedMemory.expiresAt} is null or ${agentSharedMemory.expiresAt} > ${now}`,
        ),
      );

    return entry?.value ?? null;
  }

  /**
   * Get the full entry record (with metadata) for a key.
   */
  async function getEntry(
    companyId: string,
    namespace: string,
    key: string,
  ): Promise<SharedMemoryEntry | null> {
    const now = new Date();

    const [entry] = await db
      .select()
      .from(agentSharedMemory)
      .where(
        and(
          eq(agentSharedMemory.companyId, companyId),
          eq(agentSharedMemory.namespace, namespace),
          eq(agentSharedMemory.key, key),
          sql`${agentSharedMemory.expiresAt} is null or ${agentSharedMemory.expiresAt} > ${now}`,
        ),
      );

    return entry ?? null;
  }

  /**
   * Delete a key. Silently succeeds if the key does not exist.
   */
  async function del(
    companyId: string,
    namespace: string,
    key: string,
  ): Promise<void> {
    await db
      .delete(agentSharedMemory)
      .where(
        and(
          eq(agentSharedMemory.companyId, companyId),
          eq(agentSharedMemory.namespace, namespace),
          eq(agentSharedMemory.key, key),
        ),
      );
  }

  /**
   * List all non-expired entries in a namespace.
   */
  async function list(
    companyId: string,
    namespace: string,
    opts: ListMemoryOptions = {},
  ): Promise<SharedMemoryEntry[]> {
    const { limit = 100, offset = 0, includeExpired = false } = opts;
    const now = new Date();

    const conditions = [
      eq(agentSharedMemory.companyId, companyId),
      eq(agentSharedMemory.namespace, namespace),
    ];

    if (!includeExpired) {
      conditions.push(
        sql`${agentSharedMemory.expiresAt} is null or ${agentSharedMemory.expiresAt} > ${now}`,
      );
    }

    return db
      .select()
      .from(agentSharedMemory)
      .where(and(...conditions))
      .orderBy(asc(agentSharedMemory.key))
      .limit(limit)
      .offset(offset);
  }

  /**
   * List all namespaces that have at least one non-expired key.
   */
  async function listNamespaces(companyId: string): Promise<string[]> {
    const now = new Date();

    const rows = await db
      .selectDistinct({ namespace: agentSharedMemory.namespace })
      .from(agentSharedMemory)
      .where(
        and(
          eq(agentSharedMemory.companyId, companyId),
          sql`${agentSharedMemory.expiresAt} is null or ${agentSharedMemory.expiresAt} > ${now}`,
        ),
      )
      .orderBy(asc(agentSharedMemory.namespace));

    return rows.map((r) => r.namespace);
  }

  /**
   * Purge all expired entries. Returns count of deleted rows.
   * Call periodically from a maintenance job.
   */
  async function purgeExpired(): Promise<number> {
    const now = new Date();
    const result = await db
      .delete(agentSharedMemory)
      .where(lt(agentSharedMemory.expiresAt, now))
      .returning({ id: agentSharedMemory.id });
    return result.length;
  }

  return {
    set,
    get,
    getEntry,
    del,
    list,
    listNamespaces,
    purgeExpired,
  };
}

export type SharedMemoryService = ReturnType<typeof sharedMemoryService>;
