/**
 * coordinator.ts
 * Phase 19: Coordinator Mode — API routes
 *
 * Endpoints:
 *   POST   /api/companies/:companyId/coordinator/sessions              — start coordination
 *   POST   /api/companies/:companyId/coordinator/sessions/:id/delegate — submit delegation plan
 *   GET    /api/companies/:companyId/coordinator/sessions/:id/status   — get session status
 *   PATCH  /api/companies/:companyId/coordinator/sessions/:id/cancel   — cancel session
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { coordinatorService } from "../services/coordinator.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import type { DelegationStrategy } from "@paperclipai/shared";

export function coordinatorRoutes(db: Db) {
  const router = Router();
  const coordinator = coordinatorService(db);

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/coordinator/sessions
  // Start a new coordinator session
  // ---------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/coordinator/sessions",
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);

      if (!(await coordinator.isEnabled())) {
        res
          .status(404)
          .json({ error: "coordinator_mode feature is not enabled" });
        return;
      }

      const {
        coordinatorAgentId,
        parentIssueId,
        maxParallelWorkers,
        delegationStrategy,
        workerAgentIds,
      } = req.body as {
        coordinatorAgentId?: string;
        parentIssueId?: string;
        maxParallelWorkers?: number;
        delegationStrategy?: DelegationStrategy;
        workerAgentIds?: string[];
      };

      if (!coordinatorAgentId || !parentIssueId) {
        res.status(400).json({
          error: "coordinatorAgentId and parentIssueId are required",
        });
        return;
      }

      try {
        const session = await coordinator.startCoordination({
          companyId,
          coordinatorAgentId,
          parentIssueId,
          maxParallelWorkers,
          delegationStrategy,
          config: workerAgentIds ? { workerAgentIds } : undefined,
        });
        res.status(201).json(session);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/coordinator/sessions/:sessionId/delegate
  // Submit a delegation plan
  // ---------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/coordinator/sessions/:sessionId/delegate",
    async (req, res) => {
      const { companyId, sessionId } = req.params as {
        companyId: string;
        sessionId: string;
      };
      assertCompanyAccess(req, companyId);

      if (!(await coordinator.isEnabled())) {
        res
          .status(404)
          .json({ error: "coordinator_mode feature is not enabled" });
        return;
      }

      const { tasks } = req.body as {
        tasks?: Array<{
          title: string;
          description: string;
          assignToAgentId?: string;
          dependsOnTaskIndices?: number[];
        }>;
      };

      if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        res.status(400).json({ error: "tasks array is required and must not be empty" });
        return;
      }

      try {
        const workerTasks = await coordinator.delegate(companyId, sessionId, {
          tasks,
        });
        res.status(201).json(workerTasks);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/companies/:companyId/coordinator/sessions/:sessionId/status
  // Get coordinator session status
  // ---------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/coordinator/sessions/:sessionId/status",
    async (req, res) => {
      const { companyId, sessionId } = req.params as {
        companyId: string;
        sessionId: string;
      };
      assertCompanyAccess(req, companyId);

      // We use parentIssueId from session lookup
      // For now, query by session ID via getStatus pattern
      const status = await coordinator.getStatus(companyId, sessionId);
      if (!status) {
        res.status(404).json({ error: "Coordinator session not found" });
        return;
      }

      res.json(status);
    },
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/companies/:companyId/coordinator/sessions/:sessionId/cancel
  // Cancel a coordinator session
  // ---------------------------------------------------------------------------
  router.patch(
    "/companies/:companyId/coordinator/sessions/:sessionId/cancel",
    async (req, res) => {
      const { companyId, sessionId } = req.params as {
        companyId: string;
        sessionId: string;
      };
      assertCompanyAccess(req, companyId);

      if (!(await coordinator.isEnabled())) {
        res
          .status(404)
          .json({ error: "coordinator_mode feature is not enabled" });
        return;
      }

      try {
        await coordinator.cancelSession(companyId, sessionId);
        res.status(200).json({ cancelled: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    },
  );

  return router;
}
