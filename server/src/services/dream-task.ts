/**
 * dream-task.ts
 * Phase 15: KAIROS — Background Memory Consolidation
 *
 * KAIROS (named after the Greek concept of the "opportune moment") runs a
 * background consolidation pass when an agent is idle during a timer wake.
 *
 * It aggregates recent completed issues + run summaries into a compact
 * Markdown digest stored in agent_shared_memory (namespace "kairos").
 * The digest is injected into future runs via context.paperclipKairosMemory,
 * which adapters can include in their semiStatic prompt layer.
 *
 * No LLM call is required — consolidation is pure DB aggregation.
 *
 * Storage keys (namespace "kairos"):
 *   - "digest:{agentId}"         — current Markdown digest
 *   - "consolidated_at:{agentId}"— ISO timestamp of last consolidation
 *
 * Triggered from heartbeat when:
 *   - dream_task feature flag is enabled
 *   - invocation source is "timer"
 *   - agent has no active issue (issueId is null)
 *   - min interval since last consolidation has passed
 */

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, issues, agentSharedMemory } from "@paperclipai/db";
import { featureFlagsService } from "./feature-flags.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum hours between KAIROS consolidation passes for the same agent. */
const MIN_CONSOLIDATION_INTERVAL_HOURS = 4;

/** Number of recent completed issues to include in the digest. */
const MAX_DIGEST_ISSUES = 15;

/** Number of recent runs to summarize. */
const MAX_DIGEST_RUNS = 10;

/** TTL for a stored digest (48 hours — refreshed on each consolidation). */
const DIGEST_TTL_SECONDS = 48 * 60 * 60;

const KAIROS_NAMESPACE = "kairos";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConsolidationResult {
  agentId: string;
  issueCount: number;
  runCount: number;
  digestMarkdown: string;
  consolidatedAt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Key for the stored digest value. */
function digestKey(agentId: string): string {
  return `digest:${agentId}`;
}

/** Key for the last-consolidated timestamp. */
function consolidatedAtKey(agentId: string): string {
  return `consolidated_at:${agentId}`;
}

/** Format a Date to a human-readable relative string (e.g. "3 days ago"). */
function relativeAge(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const diffH = Math.round(diffMs / (1000 * 60 * 60));
  if (diffH < 2) return "recently";
  if (diffH < 24) return `${diffH} hours ago`;
  const diffD = Math.round(diffH / 24);
  return diffD === 1 ? "1 day ago" : `${diffD} days ago`;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function dreamTaskService(db: Db) {
  const flags = featureFlagsService(db);

  async function isEnabled(): Promise<boolean> {
    return flags.isEnabled("dream_task");
  }

  // -------------------------------------------------------------------------
  // shouldConsolidate
  // -------------------------------------------------------------------------

  /**
   * Returns true when a consolidation pass is warranted.
   *
   * Conditions:
   *  1. dream_task flag is enabled.
   *  2. Last consolidation was more than MIN_CONSOLIDATION_INTERVAL_HOURS ago
   *     (or never ran).
   *  3. There are completed issues since the last consolidation (new material
   *     to incorporate — avoids burning unnecessary DB resources).
   */
  async function shouldConsolidate(
    companyId: string,
    agentId: string,
  ): Promise<boolean> {
    if (!(await isEnabled())) return false;

    // Check last consolidation timestamp
    const stored = await db
      .select({ value: agentSharedMemory.value })
      .from(agentSharedMemory)
      .where(
        and(
          eq(agentSharedMemory.companyId, companyId),
          eq(agentSharedMemory.namespace, KAIROS_NAMESPACE),
          eq(agentSharedMemory.key, consolidatedAtKey(agentId)),
        ),
      )
      .then((r) => r[0] ?? null);

    const lastConsolidatedAt: Date | null =
      stored?.value && typeof stored.value === "string"
        ? new Date(stored.value)
        : null;

    if (lastConsolidatedAt) {
      const hoursSince =
        (Date.now() - lastConsolidatedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSince < MIN_CONSOLIDATION_INTERVAL_HOURS) return false;
    }

    // Check if there are completed issues since last consolidation
    const since = lastConsolidatedAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const completedCount = await db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.assigneeAgentId, agentId),
          inArray(issues.status, ["done", "cancelled"]),
          gte(issues.updatedAt, since),
        ),
      )
      .then((r) => r.length);

    return completedCount > 0;
  }

  // -------------------------------------------------------------------------
  // consolidate
  // -------------------------------------------------------------------------

  /**
   * Runs the KAIROS consolidation pass for a given agent.
   *
   * Collects:
   *  - Recent completed/cancelled issues assigned to the agent
   *  - Recent finished heartbeat runs
   *
   * Builds a compact Markdown digest and stores it in agent_shared_memory.
   * Updates the last-consolidated timestamp.
   */
  async function consolidate(
    companyId: string,
    agentId: string,
  ): Promise<ConsolidationResult> {
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // last 7 days

    // Fetch recent completed issues
    const completedIssues = await db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        status: issues.status,
        updatedAt: issues.updatedAt,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.assigneeAgentId, agentId),
          inArray(issues.status, ["done", "cancelled"]),
          gte(issues.updatedAt, since),
        ),
      )
      .orderBy(desc(issues.updatedAt))
      .limit(MAX_DIGEST_ISSUES);

    // Fetch recent active/pending issues
    const activeIssues = await db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        status: issues.status,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.assigneeAgentId, agentId),
          inArray(issues.status, ["backlog", "todo", "in_progress", "in_review", "blocked"]),
        ),
      )
      .orderBy(desc(issues.updatedAt))
      .limit(10);

    // Fetch recent finished runs with summaries
    const recentRuns = await db
      .select({
        id: heartbeatRuns.id,
        status: heartbeatRuns.status,
        finishedAt: heartbeatRuns.finishedAt,
        stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
        error: heartbeatRuns.error,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, agentId),
          inArray(heartbeatRuns.status, ["completed", "failed"]),
          gte(heartbeatRuns.finishedAt, since),
        ),
      )
      .orderBy(desc(heartbeatRuns.finishedAt))
      .limit(MAX_DIGEST_RUNS);

    // Build Markdown digest
    const lines: string[] = [
      `## KAIROS Memory Digest`,
      `_Consolidated: ${now.toISOString().slice(0, 10)}_`,
      "",
    ];

    if (completedIssues.length > 0) {
      lines.push("### Recently Completed");
      for (const issue of completedIssues) {
        const label = issue.identifier ? `[${issue.identifier}]` : "";
        const age = issue.updatedAt ? relativeAge(new Date(issue.updatedAt), now) : "";
        const status = issue.status === "cancelled" ? " (cancelled)" : "";
        lines.push(`- ${label} ${issue.title}${status} — ${age}`);
      }
      lines.push("");
    }

    if (activeIssues.length > 0) {
      lines.push("### Active / Pending");
      for (const issue of activeIssues) {
        const label = issue.identifier ? `[${issue.identifier}]` : "";
        lines.push(`- ${label} ${issue.title} (${issue.status})`);
      }
      lines.push("");
    }

    if (recentRuns.length > 0) {
      const failed = recentRuns.filter((r) => r.status === "failed");
      if (failed.length > 0) {
        lines.push("### Recent Failures");
        for (const run of failed.slice(0, 5)) {
          const msg = run.error
            ? run.error.slice(0, 120)
            : (run.stdoutExcerpt ?? "").slice(0, 120);
          lines.push(`- Run ${run.id.slice(0, 8)}: ${msg}`);
        }
        lines.push("");
      }
    }

    lines.push(
      `_${completedIssues.length} issues consolidated from the last 7 days._`,
    );

    const digestMarkdown = lines.join("\n");
    const consolidatedAtIso = now.toISOString();

    // Persist digest and timestamp into agent_shared_memory
    const upsert = async (key: string, value: unknown) => {
      await db
        .insert(agentSharedMemory)
        .values({
          companyId,
          namespace: KAIROS_NAMESPACE,
          key,
          value,
          authorAgentId: agentId,
          ttlSeconds: DIGEST_TTL_SECONDS,
          expiresAt: new Date(now.getTime() + DIGEST_TTL_SECONDS * 1_000),
        })
        .onConflictDoUpdate({
          target: [
            agentSharedMemory.companyId,
            agentSharedMemory.namespace,
            agentSharedMemory.key,
          ],
          set: {
            value,
            authorAgentId: agentId,
            ttlSeconds: DIGEST_TTL_SECONDS,
            expiresAt: new Date(now.getTime() + DIGEST_TTL_SECONDS * 1_000),
            updatedAt: now,
          },
        });
    };

    await Promise.all([
      upsert(digestKey(agentId), digestMarkdown),
      upsert(consolidatedAtKey(agentId), consolidatedAtIso),
    ]);

    return {
      agentId,
      issueCount: completedIssues.length,
      runCount: recentRuns.length,
      digestMarkdown,
      consolidatedAt: consolidatedAtIso,
    };
  }

  // -------------------------------------------------------------------------
  // getDigest
  // -------------------------------------------------------------------------

  /**
   * Returns the stored Markdown digest for an agent, or null if none exists
   * or the feature flag is disabled.
   */
  async function getDigest(
    companyId: string,
    agentId: string,
  ): Promise<string | null> {
    if (!(await isEnabled())) return null;

    const row = await db
      .select({ value: agentSharedMemory.value, expiresAt: agentSharedMemory.expiresAt })
      .from(agentSharedMemory)
      .where(
        and(
          eq(agentSharedMemory.companyId, companyId),
          eq(agentSharedMemory.namespace, KAIROS_NAMESPACE),
          eq(agentSharedMemory.key, digestKey(agentId)),
        ),
      )
      .then((r) => r[0] ?? null);

    if (!row) return null;
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;
    return typeof row.value === "string" ? row.value : null;
  }

  return {
    isEnabled,
    shouldConsolidate,
    consolidate,
    getDigest,
  };
}
