/**
 * remote-planning.ts
 * Phase 20: ULTRAPLAN Remote Plan Offload — API routes
 *
 * Endpoints:
 *   POST   /api/companies/:companyId/plans                          — create plan session
 *   GET    /api/companies/:companyId/plans                          — list active sessions
 *   GET    /api/companies/:companyId/plans/:sessionId               — get session state
 *   DELETE /api/companies/:companyId/plans/:sessionId               — cancel session
 *   POST   /api/companies/:companyId/plans/:sessionId/approve       — approve plan
 *   POST   /api/companies/:companyId/plans/:sessionId/reject        — reject plan
 *   POST   /api/companies/:companyId/plans/:sessionId/input         — provide user input
 *   GET    /api/companies/:companyId/plans/:sessionId/execution     — execution status
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { remotePlannerService } from "../services/remote-planner.js";
import { assertCompanyAccess } from "./authz.js";
import type { PlanExecutionTarget } from "@paperclipai/shared";

export function remotePlanningRoutes(db: Db) {
  const router = Router();
  const planner = remotePlannerService(db);

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/plans
  // Create a new remote plan session
  // ---------------------------------------------------------------------------
  router.post("/companies/:companyId/plans", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    if (!(await planner.isEnabled())) {
      res.status(404).json({ error: "remote_planning feature is not enabled" });
      return;
    }

    const {
      plannerAgentId,
      sourceIssueId,
      requestedByAgentId,
      executionTarget,
      timeoutMs,
    } = req.body as {
      plannerAgentId?: string;
      sourceIssueId?: string;
      requestedByAgentId?: string;
      executionTarget?: PlanExecutionTarget;
      timeoutMs?: number;
    };

    if (!plannerAgentId) {
      res.status(400).json({ error: "plannerAgentId is required" });
      return;
    }

    try {
      const session = await planner.createPlanSession({
        companyId,
        plannerAgentId,
        sourceIssueId,
        requestedByAgentId,
        requestedByUserId: req.actor.type === "board" ? req.actor.userId ?? undefined : undefined,
        executionTarget,
        timeoutMs,
      });
      res.status(201).json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/companies/:companyId/plans
  // List active plan sessions for the company
  // ---------------------------------------------------------------------------
  router.get("/companies/:companyId/plans", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    if (!(await planner.isEnabled())) {
      res.status(404).json({ error: "remote_planning feature is not enabled" });
      return;
    }

    const sessions = await planner.listActiveSessions(companyId);
    res.json(sessions);
  });

  // ---------------------------------------------------------------------------
  // GET /api/companies/:companyId/plans/:sessionId
  // Get plan session state
  // ---------------------------------------------------------------------------
  router.get("/companies/:companyId/plans/:sessionId", async (req, res) => {
    const { companyId, sessionId } = req.params as { companyId: string; sessionId: string };
    assertCompanyAccess(req, companyId);

    const session = await planner.getSession(sessionId);
    if (!session || session.companyId !== companyId) {
      res.status(404).json({ error: "Plan session not found" });
      return;
    }
    res.json(session);
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/companies/:companyId/plans/:sessionId
  // Cancel a plan session
  // ---------------------------------------------------------------------------
  router.delete("/companies/:companyId/plans/:sessionId", async (req, res) => {
    const { companyId, sessionId } = req.params as { companyId: string; sessionId: string };
    assertCompanyAccess(req, companyId);

    const session = await planner.getSession(sessionId);
    if (!session || session.companyId !== companyId) {
      res.status(404).json({ error: "Plan session not found" });
      return;
    }

    try {
      await planner.cancelPlan(sessionId);
      res.status(200).json({ cancelled: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/plans/:sessionId/approve
  // Approve plan and trigger execution
  // ---------------------------------------------------------------------------
  router.post("/companies/:companyId/plans/:sessionId/approve", async (req, res) => {
    const { companyId, sessionId } = req.params as { companyId: string; sessionId: string };
    assertCompanyAccess(req, companyId);

    const session = await planner.getSession(sessionId);
    if (!session || session.companyId !== companyId) {
      res.status(404).json({ error: "Plan session not found" });
      return;
    }

    const { editedPlan, executionTarget } = req.body as {
      editedPlan?: string;
      executionTarget?: PlanExecutionTarget;
    };

    try {
      const result = await planner.approvePlan(sessionId, { editedPlan, executionTarget });
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/plans/:sessionId/reject
  // Reject plan and request re-planning
  // ---------------------------------------------------------------------------
  router.post("/companies/:companyId/plans/:sessionId/reject", async (req, res) => {
    const { companyId, sessionId } = req.params as { companyId: string; sessionId: string };
    assertCompanyAccess(req, companyId);

    const session = await planner.getSession(sessionId);
    if (!session || session.companyId !== companyId) {
      res.status(404).json({ error: "Plan session not found" });
      return;
    }

    const { feedback } = req.body as { feedback?: string };
    if (!feedback) {
      res.status(400).json({ error: "feedback is required when rejecting a plan" });
      return;
    }

    try {
      await planner.rejectPlan(sessionId, feedback);
      res.status(200).json({ rejected: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/plans/:sessionId/input
  // Provide user input for a needs_input session
  // ---------------------------------------------------------------------------
  router.post("/companies/:companyId/plans/:sessionId/input", async (req, res) => {
    const { companyId, sessionId } = req.params as { companyId: string; sessionId: string };
    assertCompanyAccess(req, companyId);

    const session = await planner.getSession(sessionId);
    if (!session || session.companyId !== companyId) {
      res.status(404).json({ error: "Plan session not found" });
      return;
    }

    const { input } = req.body as { input?: string };
    if (!input) {
      res.status(400).json({ error: "input is required" });
      return;
    }

    try {
      await planner.provideInput(sessionId, input);
      res.status(200).json({ inputReceived: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/companies/:companyId/plans/:sessionId/execution
  // Get execution status (coordinator session or workflow run)
  // ---------------------------------------------------------------------------
  router.get("/companies/:companyId/plans/:sessionId/execution", async (req, res) => {
    const { companyId, sessionId } = req.params as { companyId: string; sessionId: string };
    assertCompanyAccess(req, companyId);

    const session = await planner.getSession(sessionId);
    if (!session || session.companyId !== companyId) {
      res.status(404).json({ error: "Plan session not found" });
      return;
    }

    res.json({
      sessionId,
      status: session.status,
      executionTarget: session.executionTarget,
      coordinatorSessionId: session.coordinatorSessionId,
      routineRunId: session.routineRunId,
      completedAt: session.completedAt,
    });
  });

  return router;
}
