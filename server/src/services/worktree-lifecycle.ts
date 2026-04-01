/**
 * worktree-lifecycle.ts
 * Phase 22: Worktree Isolation — Lifecycle Management
 *
 * Provides pool-based reuse and lifecycle management for git worktree
 * execution workspaces used by coordinator worker agents.
 *
 * Feature flag: worktree_isolation
 * Prerequisites: Phase 19 (coordinator mode — worker agent flag)
 *
 * Design:
 *   - Coordinator workers share a per-project worktree pool.
 *   - When a worker starts, we try to activate an idle worktree instead of
 *     creating a fresh one (provision reuse).
 *   - When a worker finishes successfully, the worktree returns to the pool.
 *   - When the associated issue reaches a terminal state, the worktree is
 *     scheduled for eventual cleanup via cleanupEligibleAt.
 *   - A maintenance sweep (cleanupStale) archives worktrees past their TTL.
 *
 * No new DB schema is required — all fields are already present on
 * execution_workspaces (providerType, status, cleanupEligibleAt, etc.).
 */

import { and, desc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { executionWorkspaces } from "@paperclipai/db";
import { featureFlagsService } from "./feature-flags.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** DB row type inferred from the execution_workspaces table. */
type ExecutionWorkspaceRow = typeof executionWorkspaces.$inferSelect;

export interface WorktreeCleanupPolicy {
  /** Minutes of idle time before a worktree is eligible for cleanup. Default: 1440 (24h) */
  maxIdleMinutes: number;
  /** Maximum worktrees per project to keep in the pool. Default: 10 */
  maxPoolSize: number;
  /** Whether to preserve worktrees with unmerged changes. Default: true */
  preserveUnmergedBranches: boolean;
}

const DEFAULT_CLEANUP_POLICY: WorktreeCleanupPolicy = {
  maxIdleMinutes: 1440,
  maxPoolSize: 10,
  preserveUnmergedBranches: true,
};

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function worktreeLifecycleService(db: Db) {
  const flags = featureFlagsService(db);

  /** Feature flag guard. */
  async function isEnabled(): Promise<boolean> {
    return flags.isEnabled("worktree_isolation");
  }

  /**
   * Find the most recently used idle git_worktree workspace for a project.
   * Returns null if no reusable worktree is available.
   */
  async function findReusableWorktree(
    companyId: string,
    projectId: string,
  ): Promise<ExecutionWorkspaceRow | null> {
    const rows = await db
      .select()
      .from(executionWorkspaces)
      .where(
        and(
          eq(executionWorkspaces.companyId, companyId),
          eq(executionWorkspaces.projectId, projectId),
          eq(executionWorkspaces.providerType, "git_worktree"),
          eq(executionWorkspaces.status, "idle"),
        ),
      )
      .orderBy(desc(executionWorkspaces.lastUsedAt))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Activate a reused worktree for a new issue.
   * Sets status → "active", links to the new issue, clears cleanup fields.
   */
  async function activateReusedWorktree(
    executionWorkspaceId: string,
    issueId: string,
  ): Promise<void> {
    const now = new Date();
    await db
      .update(executionWorkspaces)
      .set({
        status: "active",
        sourceIssueId: issueId,
        lastUsedAt: now,
        cleanupEligibleAt: null,
        cleanupReason: null,
        updatedAt: now,
      })
      .where(eq(executionWorkspaces.id, executionWorkspaceId));
  }

  /**
   * Release a worktree back to the pool when a worker agent finishes.
   * Transitions status → "idle" so it can be reused by the next worker.
   */
  async function release(executionWorkspaceId: string): Promise<void> {
    await db
      .update(executionWorkspaces)
      .set({
        status: "idle",
        updatedAt: new Date(),
      })
      .where(eq(executionWorkspaces.id, executionWorkspaceId));
  }

  /**
   * Schedule a worktree for eventual cleanup when its issue reaches a
   * terminal state. Sets cleanupEligibleAt to `now + idleMinutes`.
   *
   * If no idleMinutes is provided, the DEFAULT_CLEANUP_POLICY value is used.
   */
  async function markForCleanup(
    companyId: string,
    issueId: string,
    reason: string,
    idleMinutes?: number,
  ): Promise<void> {
    const delay = idleMinutes ?? DEFAULT_CLEANUP_POLICY.maxIdleMinutes;
    const cleanupEligibleAt = new Date(Date.now() + delay * 60 * 1000);
    const now = new Date();

    await db
      .update(executionWorkspaces)
      .set({
        cleanupEligibleAt,
        cleanupReason: reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(executionWorkspaces.companyId, companyId),
          eq(executionWorkspaces.sourceIssueId, issueId),
          eq(executionWorkspaces.providerType, "git_worktree"),
          inArray(executionWorkspaces.status, ["active", "idle"]),
        ),
      );
  }

  /**
   * Archive worktrees that have exceeded their cleanup eligibility time OR
   * have been idle beyond the maxIdleMinutes TTL.
   *
   * Returns the number of worktrees archived.
   */
  async function cleanupStale(
    companyId: string,
    policy: Partial<WorktreeCleanupPolicy> = {},
  ): Promise<number> {
    const maxIdleMinutes = policy.maxIdleMinutes ?? DEFAULT_CLEANUP_POLICY.maxIdleMinutes;
    const now = new Date();
    const idleCutoff = new Date(now.getTime() - maxIdleMinutes * 60 * 1000);

    // Find idle git_worktrees that are either:
    //   (a) past their explicit cleanupEligibleAt timestamp, OR
    //   (b) idle for longer than the TTL (lastUsedAt is old enough)
    const stale = await db
      .select({ id: executionWorkspaces.id })
      .from(executionWorkspaces)
      .where(
        and(
          eq(executionWorkspaces.companyId, companyId),
          eq(executionWorkspaces.providerType, "git_worktree"),
          eq(executionWorkspaces.status, "idle"),
          or(
            and(
              isNotNull(executionWorkspaces.cleanupEligibleAt),
              lte(executionWorkspaces.cleanupEligibleAt, now),
            ),
            lte(executionWorkspaces.lastUsedAt, idleCutoff),
          ),
        ),
      );

    if (stale.length === 0) return 0;

    const staleIds = stale.map((s) => s.id);
    await db
      .update(executionWorkspaces)
      .set({
        status: "archived",
        closedAt: now,
        cleanupReason: "stale_cleanup",
        updatedAt: now,
      })
      .where(
        and(
          eq(executionWorkspaces.companyId, companyId),
          inArray(executionWorkspaces.id, staleIds),
        ),
      );

    return staleIds.length;
  }

  return {
    isEnabled,
    findReusableWorktree,
    activateReusedWorktree,
    release,
    markForCleanup,
    cleanupStale,
  };
}

export type WorktreeLifecycleServiceType = ReturnType<typeof worktreeLifecycleService>;
