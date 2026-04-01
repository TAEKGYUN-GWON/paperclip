/**
 * issue-dependencies.ts
 * Phase 12: Task Graph — Issue Dependency API routes
 *
 * Endpoints:
 *   POST   /api/companies/:companyId/issues/:issueId/dependencies        — add dependency
 *   DELETE /api/companies/:companyId/issues/:issueId/dependencies/:dependsOnId — remove dependency
 *   GET    /api/companies/:companyId/issues/:issueId/dependencies         — list what this issue depends on
 *   GET    /api/companies/:companyId/issues/:issueId/dependents           — list what is blocked by this issue
 *   GET    /api/companies/:companyId/issues/:issueId/blocked              — check if this issue is blocked
 *   POST   /api/companies/:companyId/issues/topological-sort              — sort a set of issue IDs
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { taskGraphService } from "../services/task-graph.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import type { IssueDependencyKind } from "@paperclipai/shared";

export function issueDependencyRoutes(db: Db) {
  const router = Router();
  const graph = taskGraphService(db);

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/issues/:issueId/dependencies
  // Add a dependency: issueId blocks on dependsOnIssueId
  // ---------------------------------------------------------------------------
  router.post("/companies/:companyId/issues/:issueId/dependencies", async (req, res) => {
    const { companyId, issueId } = req.params as { companyId: string; issueId: string };
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    const { dependsOnIssueId, kind } = req.body as {
      dependsOnIssueId?: string;
      kind?: IssueDependencyKind;
    };
    if (!dependsOnIssueId) {
      res.status(400).json({ error: "dependsOnIssueId is required" });
      return;
    }

    try {
      const dep = await graph.addDependency({
        companyId,
        issueId,
        dependsOnIssueId,
        kind: kind ?? "blocks",
        createdByAgentId: actor.agentId ?? undefined,
        createdByUserId: actor.actorType === "user" ? actor.actorId : undefined,
      });
      res.status(201).json(dep);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/companies/:companyId/issues/:issueId/dependencies/:dependsOnId
  // ---------------------------------------------------------------------------
  router.delete(
    "/companies/:companyId/issues/:issueId/dependencies/:dependsOnId",
    async (req, res) => {
      const { companyId, issueId, dependsOnId } = req.params as {
        companyId: string;
        issueId: string;
        dependsOnId: string;
      };
      assertCompanyAccess(req, companyId);

      await graph.removeDependency({ companyId, issueId, dependsOnIssueId: dependsOnId });
      res.status(204).send();
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/companies/:companyId/issues/:issueId/dependencies
  // What does this issue depend on?
  // ---------------------------------------------------------------------------
  router.get("/companies/:companyId/issues/:issueId/dependencies", async (req, res) => {
    const { companyId, issueId } = req.params as { companyId: string; issueId: string };
    assertCompanyAccess(req, companyId);

    const deps = await graph.getDependencies(companyId, issueId);
    res.json(deps);
  });

  // ---------------------------------------------------------------------------
  // GET /api/companies/:companyId/issues/:issueId/dependents
  // What issues are blocked waiting for this one?
  // ---------------------------------------------------------------------------
  router.get("/companies/:companyId/issues/:issueId/dependents", async (req, res) => {
    const { companyId, issueId } = req.params as { companyId: string; issueId: string };
    assertCompanyAccess(req, companyId);

    const deps = await graph.getDependents(companyId, issueId);
    res.json(deps);
  });

  // ---------------------------------------------------------------------------
  // GET /api/companies/:companyId/issues/:issueId/blocked
  // Is this issue currently blocked by unsatisfied dependencies?
  // ---------------------------------------------------------------------------
  router.get("/companies/:companyId/issues/:issueId/blocked", async (req, res) => {
    const { companyId, issueId } = req.params as { companyId: string; issueId: string };
    assertCompanyAccess(req, companyId);

    const result = await graph.isBlocked(companyId, issueId);
    res.json(result);
  });

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/issues/topological-sort
  // Body: { issueIds: string[] }
  // Returns ordered list respecting dependency edges.
  // ---------------------------------------------------------------------------
  router.post("/companies/:companyId/issues/topological-sort", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    const { issueIds } = req.body as { issueIds?: unknown };
    if (!Array.isArray(issueIds) || issueIds.some((id) => typeof id !== "string")) {
      res.status(400).json({ error: "issueIds must be an array of strings" });
      return;
    }

    try {
      const sorted = await graph.topologicalSort(companyId, issueIds as string[]);
      res.json({ sorted });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  return router;
}
