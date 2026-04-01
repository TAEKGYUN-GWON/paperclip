/**
 * task-graph.ts
 * Phase 12: Task Graph — Issue Dependency Graph
 *
 * Manages directed dependency edges between issues.
 * Provides:
 *   - CRUD for dependency edges
 *   - Cycle detection (DFS) before inserting an edge
 *   - isBlocked() check for heartbeat gate
 *   - topologicalSort() for ordered execution planning
 *
 * All graph operations are company-scoped.
 * Feature-flagged under "task_graph" — safe to import regardless of flag state.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issueDependencies, issues } from "@paperclipai/db";
import type { IssueDependencyKind } from "@paperclipai/shared";
import { featureFlagsService } from "./feature-flags.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AddDependencyInput {
  companyId: string;
  issueId: string;
  dependsOnIssueId: string;
  kind?: IssueDependencyKind;
  createdByAgentId?: string;
  createdByUserId?: string;
}

export interface RemoveDependencyInput {
  companyId: string;
  issueId: string;
  dependsOnIssueId: string;
}

export type IssueDependency = typeof issueDependencies.$inferSelect;

export interface TaskGraphBlockedResult {
  blocked: boolean;
  /** IDs of dependency issues that are not yet "done". */
  blockerIssueIds: string[];
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function taskGraphService(db: Db) {
  const flags = featureFlagsService(db);

  async function isEnabled(): Promise<boolean> {
    return flags.isEnabled("task_graph");
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Returns all direct dependsOnIssueId values for a given issueId
   * within a company (traverses "blocks" edges only for blocking logic).
   */
  async function getDirectDependencies(
    companyId: string,
    issueId: string,
  ): Promise<string[]> {
    const rows = await db
      .select({ dependsOnIssueId: issueDependencies.dependsOnIssueId })
      .from(issueDependencies)
      .where(
        and(
          eq(issueDependencies.companyId, companyId),
          eq(issueDependencies.issueId, issueId),
          eq(issueDependencies.kind, "blocks"),
        ),
      );
    return rows.map((r) => r.dependsOnIssueId);
  }

  /**
   * DFS-based cycle detection.
   * Returns true if adding edge (fromId -> toId) would create a cycle.
   *
   * Strategy: starting from `toId`, walk all outgoing "blocks" edges.
   * If we ever reach `fromId`, a cycle would form.
   */
  async function wouldCreateCycle(
    companyId: string,
    fromId: string,
    toId: string,
  ): Promise<boolean> {
    const visited = new Set<string>();
    const stack = [toId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === fromId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const deps = await getDirectDependencies(companyId, current);
      for (const d of deps) stack.push(d);
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Adds a dependency edge.
   * - Validates that both issues belong to the given company.
   * - Detects cycles; throws if one would be created.
   * - Is idempotent: returns existing record if the same edge already exists.
   */
  async function addDependency(input: AddDependencyInput): Promise<IssueDependency> {
    const kind = input.kind ?? "blocks";

    if (input.issueId === input.dependsOnIssueId) {
      throw new Error("An issue cannot depend on itself");
    }

    // Validate both issues exist in the company
    const [src, dst] = await Promise.all([
      db.select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)))
        .then((r) => r[0]),
      db.select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, input.dependsOnIssueId), eq(issues.companyId, input.companyId)))
        .then((r) => r[0]),
    ]);
    if (!src) throw new Error(`Issue ${input.issueId} not found in company ${input.companyId}`);
    if (!dst) throw new Error(`Issue ${input.dependsOnIssueId} not found in company ${input.companyId}`);

    // Cycle detection (only meaningful for "blocks" edges)
    if (kind === "blocks") {
      const cycle = await wouldCreateCycle(input.companyId, input.issueId, input.dependsOnIssueId);
      if (cycle) {
        throw new Error(
          `Adding dependency ${input.issueId} → ${input.dependsOnIssueId} would create a cycle`,
        );
      }
    }

    // Upsert — return existing row if the edge already exists
    const existing = await db
      .select()
      .from(issueDependencies)
      .where(
        and(
          eq(issueDependencies.issueId, input.issueId),
          eq(issueDependencies.dependsOnIssueId, input.dependsOnIssueId),
          eq(issueDependencies.kind, kind),
        ),
      )
      .then((r) => r[0]);
    if (existing) return existing;

    const [created] = await db
      .insert(issueDependencies)
      .values({
        companyId: input.companyId,
        issueId: input.issueId,
        dependsOnIssueId: input.dependsOnIssueId,
        kind,
        createdByAgentId: input.createdByAgentId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      })
      .returning();
    return created!;
  }

  /**
   * Removes a dependency edge.
   * No-ops gracefully if the edge does not exist.
   */
  async function removeDependency(input: RemoveDependencyInput): Promise<void> {
    await db
      .delete(issueDependencies)
      .where(
        and(
          eq(issueDependencies.companyId, input.companyId),
          eq(issueDependencies.issueId, input.issueId),
          eq(issueDependencies.dependsOnIssueId, input.dependsOnIssueId),
        ),
      );
  }

  /**
   * Returns all dependency edges where `issueId` is the blocked issue
   * (i.e., what this issue is waiting on).
   */
  async function getDependencies(
    companyId: string,
    issueId: string,
  ): Promise<IssueDependency[]> {
    return db
      .select()
      .from(issueDependencies)
      .where(
        and(
          eq(issueDependencies.companyId, companyId),
          eq(issueDependencies.issueId, issueId),
        ),
      );
  }

  /**
   * Returns all dependency edges where `issueId` is the blocking issue
   * (i.e., what issues are waiting for this one to complete).
   */
  async function getDependents(
    companyId: string,
    issueId: string,
  ): Promise<IssueDependency[]> {
    return db
      .select()
      .from(issueDependencies)
      .where(
        and(
          eq(issueDependencies.companyId, companyId),
          eq(issueDependencies.dependsOnIssueId, issueId),
        ),
      );
  }

  /**
   * Checks whether an issue is currently blocked by unsatisfied "blocks" dependencies.
   *
   * An issue is blocked if any of its direct "blocks" predecessors has a status
   * other than "done" or "cancelled".
   *
   * Returns { blocked: false } when task_graph flag is disabled — so callers
   * don't need to check the flag themselves.
   */
  async function isBlocked(
    companyId: string,
    issueId: string,
  ): Promise<TaskGraphBlockedResult> {
    if (!(await isEnabled())) {
      return { blocked: false, blockerIssueIds: [] };
    }

    const depIds = await getDirectDependencies(companyId, issueId);
    if (depIds.length === 0) return { blocked: false, blockerIssueIds: [] };

    const depStatuses = await db
      .select({ id: issues.id, status: issues.status })
      .from(issues)
      .where(inArray(issues.id, depIds));

    const blockers = depStatuses.filter(
      (d) => d.status !== "done" && d.status !== "cancelled",
    );
    return {
      blocked: blockers.length > 0,
      blockerIssueIds: blockers.map((b) => b.id),
    };
  }

  /**
   * Topological sort of a set of issue IDs.
   *
   * Returns an ordering in which every issue appears after all of its "blocks"
   * predecessors. Issues without any dependency edges relative to each other
   * are returned in their original order.
   *
   * Throws if a cycle is detected among the provided IDs.
   */
  async function topologicalSort(
    companyId: string,
    issueIds: string[],
  ): Promise<string[]> {
    if (issueIds.length === 0) return [];
    const idSet = new Set(issueIds);

    // Load all relevant edges (both endpoints must be in the provided set)
    const edges = await db
      .select({
        issueId: issueDependencies.issueId,
        dependsOnIssueId: issueDependencies.dependsOnIssueId,
      })
      .from(issueDependencies)
      .where(
        and(
          eq(issueDependencies.companyId, companyId),
          eq(issueDependencies.kind, "blocks"),
          inArray(issueDependencies.issueId, issueIds),
        ),
      );

    // Build adjacency: successor → [predecessors that must come first]
    const predecessors = new Map<string, Set<string>>();
    const successors = new Map<string, Set<string>>();
    for (const id of issueIds) {
      predecessors.set(id, new Set());
      successors.set(id, new Set());
    }
    for (const edge of edges) {
      if (!idSet.has(edge.dependsOnIssueId)) continue; // skip cross-set edges
      predecessors.get(edge.issueId)!.add(edge.dependsOnIssueId);
      successors.get(edge.dependsOnIssueId)!.add(edge.issueId);
    }

    // Kahn's algorithm
    const result: string[] = [];
    const queue: string[] = [];
    for (const id of issueIds) {
      if (predecessors.get(id)!.size === 0) queue.push(id);
    }
    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);
      for (const succ of successors.get(node) ?? []) {
        predecessors.get(succ)!.delete(node);
        if (predecessors.get(succ)!.size === 0) queue.push(succ);
      }
    }
    if (result.length !== issueIds.length) {
      throw new Error("Cycle detected in task graph — cannot produce a topological sort");
    }
    return result;
  }

  return {
    isEnabled,
    addDependency,
    removeDependency,
    getDependencies,
    getDependents,
    isBlocked,
    topologicalSort,
  };
}
