/**
 * mcp-discovery.ts
 * Phase 16: MCP Dynamic Tool Registration — Discovery Service
 *
 * DB-backed service that:
 *   1. Persists MCP server configurations in the `mcp_servers` table.
 *   2. Connects to each server via mcpSessionService (HTTP / SSE / Stdio).
 *   3. Discovers available tools via tools/list RPC.
 *   4. Registers discovered tools in PluginToolRegistry using the
 *      namespace pattern `"mcp.{serverName}:{toolName}"`.
 *   5. Provides scope-filtered tool listing for agents.
 *   6. Executes MCP tools directly (bypassing plugin worker process).
 *
 * Feature-flagged under "mcp_dynamic_tools".
 *
 * Adapted from Claude Code services/mcp/client.ts + MCPTool.ts patterns:
 *   - inputSchema passthrough (no validation of MCP tool schemas)
 *   - Memoized sessions via mcpSessionService
 *   - Server name used as plugin namespace prefix
 */

import { and, eq, or, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { mcpServers } from "@paperclipai/db";
import type {
  McpTransportType,
  McpServerStatus,
  McpServerScope,
  PaperclipPluginManifestV1,
} from "@paperclipai/shared";
import { featureFlagsService } from "./feature-flags.js";
import {
  mcpSessionService,
  type McpServerConfig,
  type McpToolDefinition,
  type McpCallToolResult,
  type McpSessionServiceType,
} from "./mcp-session.js";
import type { PluginToolRegistry } from "./plugin-tool-registry.js";
import { createPluginToolRegistry } from "./plugin-tool-registry.js";
import type { AgentToolDescriptor } from "./plugin-tool-dispatcher.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types — public API
// ---------------------------------------------------------------------------

export interface McpServerRecord {
  id: string;
  companyId: string;
  name: string;
  displayName: string;
  scope: McpServerScope;
  scopeId: string | null;
  transportType: McpTransportType;
  config: Record<string, unknown>;
  status: McpServerStatus;
  lastConnectedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterMcpServerInput {
  companyId: string;
  name: string;
  displayName: string;
  scope: McpServerScope;
  scopeId?: string;
  transportType: McpTransportType;
  config: Record<string, unknown>;
}

export interface DiscoveredTool {
  namespacedName: string;
  toolName: string;
  serverId: string;
  serverName: string;
  description: string;
  parametersSchema: Record<string, unknown>;
}

export interface McpToolExecutionContext {
  agentId: string;
  companyId: string;
}

// ---------------------------------------------------------------------------
// Internal: build McpServerConfig from DB record
// ---------------------------------------------------------------------------

function buildMcpServerConfig(record: McpServerRecord): McpServerConfig {
  const cfg = record.config;
  switch (record.transportType) {
    case "http":
      return {
        transportType: "http",
        url: cfg.url as string,
        headers: (cfg.headers ?? {}) as Record<string, string>,
      };
    case "sse":
      return {
        transportType: "sse",
        url: cfg.url as string,
        headers: (cfg.headers ?? {}) as Record<string, string>,
      };
    case "stdio":
      return {
        transportType: "stdio",
        command: cfg.command as string,
        args: (cfg.args ?? []) as string[],
        env: (cfg.env ?? {}) as Record<string, string>,
      };
    default: {
      const _exhaustive: never = record.transportType;
      throw new Error(`Unknown MCP transport type: ${_exhaustive as string}`);
    }
  }
}

/** Convert McpToolDefinition → PluginToolDeclaration-compatible shape */
function mcpToolToDeclaration(tool: McpToolDefinition) {
  return {
    name: tool.name,
    displayName: tool.name,
    description: tool.description ?? `MCP tool: ${tool.name}`,
    parametersSchema: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
  };
}

/** MCP plugin namespace from server name, e.g. "github-tools" → "mcp.github-tools" */
function mcpPluginId(serverName: string): string {
  return `mcp.${serverName}`;
}

// ---------------------------------------------------------------------------
// McpDiscoveryService factory
// ---------------------------------------------------------------------------

export function mcpDiscoveryService(db: Db, toolRegistry?: PluginToolRegistry) {
  const log = logger.child({ service: "mcp-discovery" });
  const flags = featureFlagsService(db);
  const sessions: McpSessionServiceType = mcpSessionService(db);

  /** Fallback in-process registry when no shared registry is injected. */
  const registry: PluginToolRegistry = toolRegistry ?? createPluginToolRegistry();

  /**
   * Map from namespaced tool name → { serverId, toolName } for execution routing.
   * Claude Code MCPTool.ts routes execution back through the session that registered it.
   */
  const toolExecutionMap = new Map<string, { serverId: string; toolName: string }>();

  // -------------------------------------------------------------------------
  // Feature flag gate
  // -------------------------------------------------------------------------

  async function isEnabled(): Promise<boolean> {
    return flags.isEnabled("mcp_dynamic_tools");
  }

  // -------------------------------------------------------------------------
  // Server CRUD
  // -------------------------------------------------------------------------

  async function registerServer(input: RegisterMcpServerInput): Promise<McpServerRecord> {
    const [row] = await db
      .insert(mcpServers)
      .values({
        companyId: input.companyId,
        name: input.name,
        displayName: input.displayName,
        scope: input.scope,
        scopeId: input.scopeId ?? null,
        transportType: input.transportType,
        config: input.config,
        status: "active",
      })
      .returning();

    log.info(
      { serverId: row.id, name: row.name, transportType: row.transportType },
      "MCP server registered",
    );

    return row as McpServerRecord;
  }

  async function getServer(serverId: string, companyId: string): Promise<McpServerRecord | null> {
    const rows = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.companyId, companyId)))
      .limit(1);
    return (rows[0] as McpServerRecord) ?? null;
  }

  async function listActiveServers(companyId: string): Promise<McpServerRecord[]> {
    return db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.companyId, companyId),
          eq(mcpServers.status, "active"),
        ),
      ) as Promise<McpServerRecord[]>;
  }

  async function updateServer(
    serverId: string,
    companyId: string,
    patch: Record<string, unknown>,
  ): Promise<McpServerRecord | null> {
    const allowed: Record<string, boolean> = {
      displayName: true,
      config: true,
      transportType: true,
      status: true,
    };
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of Object.keys(patch)) {
      if (allowed[key]) update[key] = patch[key];
    }

    const rows = await db
      .update(mcpServers)
      .set(update)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.companyId, companyId)))
      .returning();
    return (rows[0] as McpServerRecord) ?? null;
  }

  async function disableServer(serverId: string, companyId: string): Promise<void> {
    await db
      .update(mcpServers)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.companyId, companyId)));

    const server = await getServer(serverId, companyId);
    if (server) {
      registry.unregisterPlugin(mcpPluginId(server.name));
      // Remove execution routes for this server
      for (const [ns, routing] of toolExecutionMap.entries()) {
        if (routing.serverId === serverId) toolExecutionMap.delete(ns);
      }
    }

    log.info({ serverId }, "MCP server disabled, tools unregistered");
  }

  // -------------------------------------------------------------------------
  // Connect + Discover
  // -------------------------------------------------------------------------

  /**
   * Connect to an MCP server, discover its tools, and register them.
   * Adapted from Claude Code connectToServer() + fetchToolsForClient().
   */
  async function connectAndDiscoverTools(serverId: string, companyId: string): Promise<DiscoveredTool[]> {
    const server = await getServer(serverId, companyId);
    if (!server) throw new Error(`MCP server ${serverId} not found`);
    if (server.status === "disabled") {
      log.debug({ serverId }, "skipping disabled MCP server");
      return [];
    }

    const config = buildMcpServerConfig(server);

    try {
      const conn = await sessions.getOrCreate(serverId, config);
      await sessions.initialize(conn);
      const tools = await sessions.listTools(conn);

      // Update last_connected_at
      await db
        .update(mcpServers)
        .set({ lastConnectedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(mcpServers.id, serverId));

      // Register tools in the plugin tool registry using namespace "mcp.{serverName}"
      const pluginId = mcpPluginId(server.name);
      const declarations = tools.map(mcpToolToDeclaration);

      // Re-register (idempotent — clears previous tools for this pluginId)
      registry.registerPlugin(
        pluginId,
        { tools: declarations } as unknown as PaperclipPluginManifestV1,
        serverId,
      );

      // Build execution routing map
      const discovered: DiscoveredTool[] = [];
      for (const tool of tools) {
        const namespacedName = registry.buildNamespacedName(pluginId, tool.name);
        toolExecutionMap.set(namespacedName, { serverId, toolName: tool.name });
        discovered.push({
          namespacedName,
          toolName: tool.name,
          serverId,
          serverName: server.name,
          description: tool.description ?? "",
          parametersSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
        });
      }

      log.info(
        { serverId, serverName: server.name, toolCount: tools.length },
        "MCP tools discovered and registered",
      );

      return discovered;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db
        .update(mcpServers)
        .set({ status: "error", lastError: errorMsg, updatedAt: new Date() })
        .where(eq(mcpServers.id, serverId));
      log.warn({ serverId, err }, "MCP server connection failed");
      throw err;
    }
  }

  /**
   * Refresh all active MCP servers for a company.
   * Called on server startup or when a company's MCP config changes.
   */
  async function refreshAllServers(companyId: string): Promise<void> {
    if (!(await isEnabled())) return;

    const active = await listActiveServers(companyId);
    log.info({ companyId, count: active.length }, "refreshing MCP servers");

    await Promise.allSettled(
      active.map((s) =>
        connectAndDiscoverTools(s.id, companyId).catch((err) => {
          log.warn({ serverId: s.id, err }, "MCP server refresh failed (continuing)");
        }),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Tool listing (scope-filtered for agents)
  // -------------------------------------------------------------------------

  /**
   * List MCP tools available to an agent, filtered by scope hierarchy.
   * Scope resolution: company + project (if projectId given) + agent-specific.
   *
   * Adapted from Claude Code initializeAgentMcpServers() scope resolution.
   */
  async function listToolsForAgent(
    companyId: string,
    agentId: string,
    projectId?: string,
  ): Promise<AgentToolDescriptor[]> {
    if (!(await isEnabled())) return [];

    // Load servers scoped to: company, project (if given), or this agent
    const scopeConditions = [
      eq(mcpServers.scope, "company"),
      ...(projectId
        ? [and(eq(mcpServers.scope, "project"), eq(mcpServers.scopeId, projectId))!]
        : []),
      and(eq(mcpServers.scope, "agent"), eq(mcpServers.scopeId, agentId))!,
    ];

    const rows = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.companyId, companyId),
          eq(mcpServers.status, "active"),
          or(...scopeConditions),
        ),
      ) as McpServerRecord[];

    // Collect all registered tools for these servers
    const result: AgentToolDescriptor[] = [];
    for (const server of rows) {
      const pluginId = mcpPluginId(server.name);
      const tools = registry.listTools({ pluginId });
      for (const tool of tools) {
        result.push({
          name: tool.namespacedName,
          displayName: tool.displayName,
          description: tool.description,
          parametersSchema: tool.parametersSchema,
          pluginId: tool.pluginDbId,
        });
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Tool execution
  // -------------------------------------------------------------------------

  /**
   * Execute an MCP tool by its namespaced name.
   * Routes directly to the MCP server session (bypasses plugin worker process).
   * Claude Code MCPTool.ts pattern: passthrough input → call tools/call RPC.
   */
  async function executeMcpTool(
    namespacedName: string,
    args: Record<string, unknown>,
    _ctx: McpToolExecutionContext,
  ): Promise<McpCallToolResult> {
    const routing = toolExecutionMap.get(namespacedName);
    if (!routing) {
      throw new Error(`MCP tool "${namespacedName}" not registered — server may not be connected`);
    }

    const { serverId, toolName } = routing;

    // Look up server config for potential reconnect
    const server = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, serverId))
      .limit(1)
      .then((rows) => rows[0] as McpServerRecord | undefined);

    if (!server) throw new Error(`MCP server ${serverId} not found`);

    const config = buildMcpServerConfig(server);

    try {
      const conn = await sessions.getOrCreate(serverId, config);
      const result = await sessions.callTool(conn, toolName, args);

      log.debug(
        { namespacedName, toolName, serverId, isError: result.isError },
        "MCP tool executed",
      );

      return result;
    } catch (err) {
      // On session expiry, reconnect once and retry
      const { McpSessionExpiredError } = await import("./mcp-session.js");
      if (err instanceof McpSessionExpiredError) {
        log.warn({ namespacedName, serverId }, "MCP session expired, reconnecting");
        const conn = await sessions.reconnect(serverId, config);
        if (!conn) throw new Error(`MCP reconnect failed for server ${serverId}`);
        return sessions.callTool(conn, toolName, args);
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  async function healthCheck(serverId: string): Promise<"healthy" | "degraded" | "unreachable"> {
    return sessions.healthCheck(serverId);
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  async function teardown(): Promise<void> {
    toolExecutionMap.clear();
    await sessions.teardownAll();
    log.info("MCP discovery service torn down");
  }

  return {
    isEnabled,
    registerServer,
    getServer,
    listActiveServers,
    updateServer,
    disableServer,
    connectAndDiscoverTools,
    refreshAllServers,
    listToolsForAgent,
    executeMcpTool,
    healthCheck,
    teardown,
  };
}

export type McpDiscoveryServiceType = ReturnType<typeof mcpDiscoveryService>;
