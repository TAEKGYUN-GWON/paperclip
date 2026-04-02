/**
 * mcp.ts
 * Phase 16: MCP Dynamic Tool Registration — API routes
 *
 * Endpoints:
 *   GET    /api/companies/:companyId/mcp-servers                              — list servers
 *   POST   /api/companies/:companyId/mcp-servers                              — register server
 *   GET    /api/companies/:companyId/mcp-servers/:serverId                    — get server
 *   PATCH  /api/companies/:companyId/mcp-servers/:serverId                    — update server
 *   DELETE /api/companies/:companyId/mcp-servers/:serverId                    — disable server
 *   POST   /api/companies/:companyId/mcp-servers/:serverId/connect            — connect & discover tools
 *   GET    /api/companies/:companyId/agents/:agentId/mcp-servers              — list tools for agent
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { mcpDiscoveryService } from "../services/mcp-discovery.js";
import { assertCompanyAccess } from "./authz.js";

export function mcpRoutes(db: Db) {
  const router = Router();
  const mcp = mcpDiscoveryService(db);

  // ---------------------------------------------------------------------------
  // GET /api/companies/:companyId/mcp-servers
  // List all active MCP servers for the company
  // ---------------------------------------------------------------------------
  router.get("/companies/:companyId/mcp-servers", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    if (!(await mcp.isEnabled())) {
      res.status(404).json({ error: "mcp_dynamic_tools feature is not enabled" });
      return;
    }

    try {
      const servers = await mcp.listActiveServers(companyId);
      res.json(servers);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/mcp-servers
  // Register a new MCP server
  // ---------------------------------------------------------------------------
  router.post("/companies/:companyId/mcp-servers", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    if (!(await mcp.isEnabled())) {
      res.status(404).json({ error: "mcp_dynamic_tools feature is not enabled" });
      return;
    }

    const { name, displayName, scope, scopeId, transportType, config } = req.body as {
      name?: string;
      displayName?: string;
      scope?: string;
      scopeId?: string;
      transportType?: string;
      config?: Record<string, unknown>;
    };

    if (!name || !transportType || !config) {
      res.status(400).json({ error: "name, transportType, and config are required" });
      return;
    }

    try {
      const server = await mcp.registerServer({
        companyId,
        name,
        displayName: displayName ?? name,
        scope: (scope as "company" | "project" | "agent") ?? "company",
        scopeId,
        transportType: transportType as "http" | "sse" | "stdio",
        config,
      });
      res.status(201).json(server);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/companies/:companyId/mcp-servers/:serverId
  // Get a single MCP server
  // ---------------------------------------------------------------------------
  router.get("/companies/:companyId/mcp-servers/:serverId", async (req, res) => {
    const { companyId, serverId } = req.params as { companyId: string; serverId: string };
    assertCompanyAccess(req, companyId);

    if (!(await mcp.isEnabled())) {
      res.status(404).json({ error: "mcp_dynamic_tools feature is not enabled" });
      return;
    }

    try {
      const server = await mcp.getServer(serverId, companyId);
      if (!server) {
        res.status(404).json({ error: "MCP server not found" });
        return;
      }
      res.json(server);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/companies/:companyId/mcp-servers/:serverId
  // Update MCP server fields (displayName, config, status)
  // ---------------------------------------------------------------------------
  router.patch("/companies/:companyId/mcp-servers/:serverId", async (req, res) => {
    const { companyId, serverId } = req.params as { companyId: string; serverId: string };
    assertCompanyAccess(req, companyId);

    if (!(await mcp.isEnabled())) {
      res.status(404).json({ error: "mcp_dynamic_tools feature is not enabled" });
      return;
    }

    try {
      const server = await mcp.updateServer(serverId, companyId, req.body as Record<string, unknown>);
      if (!server) {
        res.status(404).json({ error: "MCP server not found" });
        return;
      }
      res.json(server);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/companies/:companyId/mcp-servers/:serverId
  // Disable an MCP server and unregister its tools
  // ---------------------------------------------------------------------------
  router.delete("/companies/:companyId/mcp-servers/:serverId", async (req, res) => {
    const { companyId, serverId } = req.params as { companyId: string; serverId: string };
    assertCompanyAccess(req, companyId);

    if (!(await mcp.isEnabled())) {
      res.status(404).json({ error: "mcp_dynamic_tools feature is not enabled" });
      return;
    }

    try {
      await mcp.disableServer(serverId, companyId);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/companies/:companyId/mcp-servers/:serverId/connect
  // Connect to MCP server and discover/register its tools
  // ---------------------------------------------------------------------------
  router.post("/companies/:companyId/mcp-servers/:serverId/connect", async (req, res) => {
    const { companyId, serverId } = req.params as { companyId: string; serverId: string };
    assertCompanyAccess(req, companyId);

    if (!(await mcp.isEnabled())) {
      res.status(404).json({ error: "mcp_dynamic_tools feature is not enabled" });
      return;
    }

    try {
      const tools = await mcp.connectAndDiscoverTools(serverId, companyId);
      res.json({ tools });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/companies/:companyId/agents/:agentId/mcp-servers
  // List discovered tools available to a specific agent
  // ---------------------------------------------------------------------------
  router.get("/companies/:companyId/agents/:agentId/mcp-servers", async (req, res) => {
    const { companyId, agentId } = req.params as { companyId: string; agentId: string };
    const projectId = req.query.projectId as string | undefined;
    assertCompanyAccess(req, companyId);

    if (!(await mcp.isEnabled())) {
      res.status(404).json({ error: "mcp_dynamic_tools feature is not enabled" });
      return;
    }

    try {
      const tools = await mcp.listToolsForAgent(companyId, agentId, projectId);
      res.json(tools);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  return router;
}
