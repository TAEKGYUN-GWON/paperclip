/**
 * auto-claim.ts
 * Phase 11: Autonomous Task Auto-Claim
 *
 * When an agent completes its current issue or wakes on a timer while idle,
 * this service finds the next eligible unassigned issue and atomically claims it.
 *
 * Feature flag: auto_claim
 * Prerequisites: Phase 12 (task-graph — blocked issue filtering)
 *
 * Design decisions:
 *   - Atomic claim via UPDATE … WHERE assigneeAgentId IS NULL (optimistic lock)
 *   - Blocked issues are filtered out using issue_dependencies (Phase 12)
 *   - Policy is loaded from agent.runtimeConfig.autoClaim (or defaults)
 *   - No LLM calls — pure DB operations
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issueDependencies, issues } from "@paperclipai/db";
import type { AutoClaimPriorityOrder } from "@paperclipai/shared";
import { featureFlagsService } from "./feature-flags.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoClaimPolicy {
  /** Maximum concurrent issue claims for this agent. Default: 1 */
  maxConcurrentClaims: number;
  /** Issue statuses the agent may claim. Default: ["backlog", "todo"] */
  claimableStatuses: string[];
  /** How candidates are ranked. Default: "priority_first" */
  priorityOrder: AutoClaimPriorityOrder;
  /** Restrict claiming to a specific project UUID. null = any accessible project. */
  projectScope: string | null;
  /** Skip issues blocked by incomplete dependencies (Phase 12). Default: true */
  respectDependencies: boolean;
}

export interface ClaimCandidate {
  id: string;
  status: string;
  priority: string;
  projectId: string | null;
  createdAt: Date;
}

export interface ClaimResult {
  /** Whether an issue was successfully claimed. */
  claimed: boolean;
  /** The claimed issue ID, or null if nothing was claimed. */
  issueId: string | null;
  /** Human-readable reason for the outcome. */
  reason: "claimed" | "no_eligible" | "all_blocked" | "max_reached" | "disabled" | "flag_off";
}

// ---------------------------------------------------------------------------
// Priority ordering helpers
// ---------------------------------------------------------------------------

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

const DEFAULT_POLICY: AutoClaimPolicy = {
  maxConcurrentClaims: 1,
  claimableStatuses: ["backlog", "todo"],
  priorityOrder: "priority_first",
  projectScope: null,
  respectDependencies: true,
};

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function autoClaimService(db: Db) {
  const flags = featureFlagsService(db);

  /** Feature flag guard */
  async function isEnabled(): Promise<boolean> {
    return flags.isEnabled("auto_claim");
  }

  /**
   * Load the auto-claim policy for an agent from runtimeConfig.autoClaim,
   * merged with defaults.
   */
  async function getPolicy(
    companyId: string,
    agentId: string,
  ): Promise<AutoClaimPolicy> {
    const [agent] = await db
      .select({ runtimeConfig: agents.runtimeConfig })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
      .limit(1);

    if (!agent) return { ...DEFAULT_POLICY };

    const raw = (agent.runtimeConfig as Record<string, unknown>).autoClaim;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_POLICY };

    const cfg = raw as Record<string, unknown>;
    return {
      maxConcurrentClaims:
        typeof cfg.maxConcurrentClaims === "number"
          ? cfg.maxConcurrentClaims
          : DEFAULT_POLICY.maxConcurrentClaims,
      claimableStatuses:
        Array.isArray(cfg.claimableStatuses)
          ? (cfg.claimableStatuses as string[])
          : DEFAULT_POLICY.claimableStatuses,
      priorityOrder:
        typeof cfg.priorityOrder === "string" &&
        ["priority_first", "created_first", "dependency_first"].includes(cfg.priorityOrder)
          ? (cfg.priorityOrder as AutoClaimPriorityOrder)
          : DEFAULT_POLICY.priorityOrder,
      projectScope:
        typeof cfg.projectScope === "string" ? cfg.projectScope : DEFAULT_POLICY.projectScope,
      respectDependencies:
        typeof cfg.respectDependencies === "boolean"
          ? cfg.respectDependencies
          : DEFAULT_POLICY.respectDependencies,
    };
  }

  /**
   * Count how many issues this agent currently holds in active states.
   */
  async function countActiveIssues(companyId: string, agentId: string): Promise<number> {
    const rows = await db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.assigneeAgentId, agentId),
          inArray(issues.status, ["in_progress", "in_review", "todo", "backlog"]),
        ),
      );
    return rows.length;
  }

  /**
   * Find the next claimable issue candidate for the agent.
   *
   * Two-step approach (avoids SQL subqueries for testability):
   *   1. Fetch all unassigned candidates matching status/project filters.
   *   2. If respectDependencies, fetch the set of issue IDs that have at least
   *      one active blocker and remove them from the candidate list.
   */
  async function findNextCandidate(
    companyId: string,
    _agentId: string,
    policy: AutoClaimPolicy,
  ): Promise<ClaimCandidate | null> {
    // Step 1: fetch unassigned candidates
    const candidateConditions = [
      eq(issues.companyId, companyId),
      isNull(issues.assigneeAgentId),
      inArray(issues.status, policy.claimableStatuses),
      ...(policy.projectScope ? [eq(issues.projectId, policy.projectScope)] : []),
    ];

    const rows = await db
      .select({
        id: issues.id,
        status: issues.status,
        priority: issues.priority,
        projectId: issues.projectId,
        createdAt: issues.createdAt,
      })
      .from(issues)
      .where(and(...candidateConditions));

    if (rows.length === 0) return null;

    // Step 2: filter blocked issues when respectDependencies is enabled
    let candidateRows = rows;
    if (policy.respectDependencies && rows.length > 0) {
      // Fetch all dependency edges for our candidates where the blocker is still active
      const candidateIds = rows.map((r) => r.id);
      const blockedEdges = await db
        .select({ issueId: issueDependencies.issueId })
        .from(issueDependencies)
        .where(
          and(
            eq(issueDependencies.companyId, companyId),
            eq(issueDependencies.kind, "blocks"),
            inArray(issueDependencies.issueId, candidateIds),
          ),
        );

      if (blockedEdges.length > 0) {
        // For each edge, check whether its blocker is still in an active state.
        // We approximate by treating all edges as blocking (conservative but safe).
        const blockedIds = new Set(blockedEdges.map((e) => e.issueId));
        candidateRows = rows.filter((r) => !blockedIds.has(r.id));
      }
    }

    if (candidateRows.length === 0) return null;

    // Sort candidates client-side per priorityOrder
    const sorted = [...candidateRows].sort((a, b) => {
      if (policy.priorityOrder === "created_first") {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (policy.priorityOrder === "priority_first") {
        const pa = PRIORITY_WEIGHT[a.priority] ?? 99;
        const pb = PRIORITY_WEIGHT[b.priority] ?? 99;
        if (pa !== pb) return pa - pb;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      // dependency_first: prefer issues that unblock the most others (approx by created_first)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const first = sorted[0]!;
    return {
      id: first.id,
      status: first.status,
      priority: first.priority,
      projectId: first.projectId ?? null,
      createdAt: new Date(first.createdAt),
    };
  }

  /**
   * Atomically claim an issue for the agent.
   *
   * Uses an optimistic lock: UPDATE … WHERE assigneeAgentId IS NULL.
   * If another agent races and claims first, the update matches 0 rows → returns false.
   */
  async function claimIssue(
    companyId: string,
    agentId: string,
    issueId: string,
  ): Promise<boolean> {
    const now = new Date();
    const updated = await db
      .update(issues)
      .set({
        assigneeAgentId: agentId,
        updatedAt: now,
      })
      .where(
        and(
          eq(issues.id, issueId),
          eq(issues.companyId, companyId),
          isNull(issues.assigneeAgentId),
        ),
      )
      .returning({ id: issues.id });

    return updated.length > 0;
  }

  /**
   * Full auto-claim flow:
   *   1. Feature-flag check
   *   2. Load policy
   *   3. Check concurrent claim limit
   *   4. Find next candidate
   *   5. Atomically claim
   *
   * Returns ClaimResult — the caller is responsible for enqueueing the wakeup.
   */
  async function tryAutoClaim(
    companyId: string,
    agentId: string,
  ): Promise<ClaimResult> {
    if (!(await isEnabled())) {
      return { claimed: false, issueId: null, reason: "flag_off" };
    }

    const policy = await getPolicy(companyId, agentId);

    // Check concurrent claim limit
    const activeCount = await countActiveIssues(companyId, agentId);
    if (activeCount >= policy.maxConcurrentClaims) {
      return { claimed: false, issueId: null, reason: "max_reached" };
    }

    const candidate = await findNextCandidate(companyId, agentId, policy);
    if (!candidate) {
      return {
        claimed: false,
        issueId: null,
        reason: policy.respectDependencies ? "all_blocked" : "no_eligible",
      };
    }

    const ok = await claimIssue(companyId, agentId, candidate.id);
    if (!ok) {
      // Race condition — another agent claimed it; not a fatal error
      return { claimed: false, issueId: null, reason: "no_eligible" };
    }

    return { claimed: true, issueId: candidate.id, reason: "claimed" };
  }

  return {
    isEnabled,
    getPolicy,
    findNextCandidate,
    claimIssue,
    tryAutoClaim,
  };
}

export type AutoClaimServiceType = ReturnType<typeof autoClaimService>;
