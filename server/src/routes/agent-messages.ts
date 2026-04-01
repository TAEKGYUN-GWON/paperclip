/**
 * agent-messages.ts
 * Phase 18: Message Bus API routes
 *
 * Endpoints:
 *   POST   /api/agents/:agentId/messages            — send direct message
 *   POST   /api/companies/:companyId/agent-messages/broadcast — broadcast
 *   GET    /api/agents/:agentId/messages             — inbox
 *   GET    /api/agents/:agentId/messages/outbox      — outbox
 *   GET    /api/agent-messages/:messageId            — single message
 *   PATCH  /api/agent-messages/:messageId/read       — mark read
 *   GET    /api/companies/:companyId/shared-memory/:namespace — list namespace
 *   PUT    /api/companies/:companyId/shared-memory/:namespace/:key — set value
 *   GET    /api/companies/:companyId/shared-memory/:namespace/:key — get value
 *   DELETE /api/companies/:companyId/shared-memory/:namespace/:key — delete value
 */

import { Router, type Response } from "express";
import type { Db } from "@paperclipai/db";
import { messageBusService, sharedMemoryService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import type { AgentMessagePriority, AgentMessageStatus, AgentMessageType } from "@paperclipai/shared";

export function agentMessageRoutes(db: Db) {
  const router = Router();
  const msgBus = messageBusService(db);
  const sharedMem = sharedMemoryService(db);

  // ---------------------------------------------------------------------------
  // Guard: feature flag check
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function requireFeatureEnabled(res: Response<any, any>): Promise<boolean> {
    const enabled = await msgBus.isEnabled();
    if (!enabled) {
      res.status(404).json({ error: "Message Bus feature is not enabled" });
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // POST /api/agents/:agentId/messages
  // Send a direct message to an agent
  // ---------------------------------------------------------------------------
  router.post("/agents/:agentId/messages", async (req, res) => {
    if (!(await requireFeatureEnabled(res))) return;

    const toAgentId = req.params.agentId as string;
    const actor = getActorInfo(req);

    const {
      fromAgentId,
      companyId,
      type,
      body,
      subject,
      metadata,
      priority,
      replyToId,
      ttlSeconds,
    } = req.body as {
      fromAgentId: string;
      companyId: string;
      type: AgentMessageType;
      body: string;
      subject?: string;
      metadata?: Record<string, unknown>;
      priority?: AgentMessagePriority;
      replyToId?: string;
      ttlSeconds?: number;
    };

    if (!companyId || !fromAgentId || !type || !body) {
      res.status(400).json({ error: "companyId, fromAgentId, type, and body are required" });
      return;
    }

    assertCompanyAccess(req, companyId);

    // Agents can only send messages as themselves
    if (actor.actorType === "agent" && actor.agentId !== fromAgentId) {
      res.status(403).json({ error: "Agents may only send messages as themselves" });
      return;
    }

    const message = await msgBus.send({
      companyId,
      fromAgentId,
      toAgentId,
      mode: "direct",
      priority,
      type,
      subject,
      body,
      metadata,
      replyToId,
      ttlSeconds,
    });

    res.status(201).json({ message });
  });

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/agent-messages/broadcast
  // Broadcast a message to all agents in the company
  // ---------------------------------------------------------------------------
  router.post("/companies/:companyId/agent-messages/broadcast", async (req, res) => {
    if (!(await requireFeatureEnabled(res))) return;

    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const actor = getActorInfo(req);
    const {
      fromAgentId,
      type,
      body,
      subject,
      metadata,
      priority,
      ttlSeconds,
    } = req.body as {
      fromAgentId: string;
      type: AgentMessageType;
      body: string;
      subject?: string;
      metadata?: Record<string, unknown>;
      priority?: AgentMessagePriority;
      ttlSeconds?: number;
    };

    if (!fromAgentId || !type || !body) {
      res.status(400).json({ error: "fromAgentId, type, and body are required" });
      return;
    }

    if (actor.actorType === "agent" && actor.agentId !== fromAgentId) {
      res.status(403).json({ error: "Agents may only send messages as themselves" });
      return;
    }

    const message = await msgBus.broadcast({
      companyId,
      fromAgentId,
      priority,
      type,
      subject,
      body,
      metadata,
      ttlSeconds,
    });

    res.status(201).json({ message });
  });

  // ---------------------------------------------------------------------------
  // GET /api/agents/:agentId/messages
  // Inbox for an agent
  // ---------------------------------------------------------------------------
  router.get("/agents/:agentId/messages", async (req, res) => {
    if (!(await requireFeatureEnabled(res))) return;

    const agentId = req.params.agentId as string;
    const actor = getActorInfo(req);

    // Agents can only read their own inbox unless board
    if (actor.actorType === "agent" && actor.agentId !== agentId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const status = req.query.status as string | undefined;
    const priority = req.query.priority !== undefined
      ? Number(req.query.priority)
      : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const messages = await msgBus.getInbox(agentId, {
      status: status as AgentMessageStatus | undefined,
      priority: priority as AgentMessagePriority | undefined,
      limit,
      offset,
    });

    res.json({ messages });
  });

  // ---------------------------------------------------------------------------
  // GET /api/agents/:agentId/messages/outbox
  // Outbox for an agent
  // ---------------------------------------------------------------------------
  router.get("/agents/:agentId/messages/outbox", async (req, res) => {
    if (!(await requireFeatureEnabled(res))) return;

    const agentId = req.params.agentId as string;
    const actor = getActorInfo(req);

    if (actor.actorType === "agent" && actor.agentId !== agentId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const messages = await msgBus.getOutbox(agentId, { limit, offset });
    res.json({ messages });
  });

  // ---------------------------------------------------------------------------
  // GET /api/agent-messages/:messageId
  // Single message lookup
  // ---------------------------------------------------------------------------
  router.get("/agent-messages/:messageId", async (req, res) => {
    if (!(await requireFeatureEnabled(res))) return;

    const messageId = req.params.messageId as string;
    const companyId = req.query.companyId as string | undefined;

    if (!companyId) {
      res.status(400).json({ error: "companyId query parameter is required" });
      return;
    }

    assertCompanyAccess(req, companyId);

    const message = await msgBus.getById(messageId, companyId);
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    res.json({ message });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/agent-messages/:messageId/read
  // Mark a message as read
  // ---------------------------------------------------------------------------
  router.patch("/agent-messages/:messageId/read", async (req, res) => {
    if (!(await requireFeatureEnabled(res))) return;

    const messageId = req.params.messageId as string;
    const companyId = req.body.companyId as string | undefined;

    if (!companyId) {
      res.status(400).json({ error: "companyId is required in body" });
      return;
    }

    assertCompanyAccess(req, companyId);

    const message = await msgBus.getById(messageId, companyId);
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    await msgBus.markRead(messageId);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Shared Memory endpoints
  // ---------------------------------------------------------------------------

  // GET /api/companies/:companyId/shared-memory/:namespace
  router.get("/companies/:companyId/shared-memory/:namespace", async (req, res) => {
    if (!(await requireFeatureEnabled(res))) return;

    const { companyId, namespace } = req.params as { companyId: string; namespace: string };
    assertCompanyAccess(req, companyId);

    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const entries = await sharedMem.list(companyId, namespace, { limit, offset });
    res.json({ entries });
  });

  // PUT /api/companies/:companyId/shared-memory/:namespace/:key
  router.put("/companies/:companyId/shared-memory/:namespace/:key", async (req, res) => {
    if (!(await requireFeatureEnabled(res))) return;

    const { companyId, namespace, key } = req.params as {
      companyId: string;
      namespace: string;
      key: string;
    };
    assertCompanyAccess(req, companyId);

    const { value, ttlSeconds, authorAgentId } = req.body as {
      value: unknown;
      ttlSeconds?: number;
      authorAgentId?: string;
    };

    if (value === undefined) {
      res.status(400).json({ error: "value is required" });
      return;
    }

    const entry = await sharedMem.set(companyId, namespace, key, value, {
      ttlSeconds,
      authorAgentId,
    });

    res.json({ entry });
  });

  // GET /api/companies/:companyId/shared-memory/:namespace/:key
  router.get("/companies/:companyId/shared-memory/:namespace/:key", async (req, res) => {
    if (!(await requireFeatureEnabled(res))) return;

    const { companyId, namespace, key } = req.params as {
      companyId: string;
      namespace: string;
      key: string;
    };
    assertCompanyAccess(req, companyId);

    const entry = await sharedMem.getEntry(companyId, namespace, key);
    if (!entry) {
      res.status(404).json({ error: "Key not found or expired" });
      return;
    }

    res.json({ entry });
  });

  // DELETE /api/companies/:companyId/shared-memory/:namespace/:key
  router.delete("/companies/:companyId/shared-memory/:namespace/:key", async (req, res) => {
    if (!(await requireFeatureEnabled(res))) return;

    const { companyId, namespace, key } = req.params as {
      companyId: string;
      namespace: string;
      key: string;
    };
    assertCompanyAccess(req, companyId);

    await sharedMem.del(companyId, namespace, key);
    res.json({ ok: true });
  });

  return router;
}
