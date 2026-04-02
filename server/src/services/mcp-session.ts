/**
 * mcp-session.ts
 * Phase 16: MCP Dynamic Tool Registration — Session Management
 *
 * Lightweight MCP JSON-RPC 2.0 client WITHOUT external SDK dependency.
 * Adapted from Claude Code services/mcp/client.ts connection patterns:
 *   - Memoized connections (connect once, reuse)
 *   - Automatic reconnect: MAX_RECONNECT_ATTEMPTS=5, exponential backoff 1s→30s
 *   - Session expiry detection (HTTP 404 / JSON-RPC -32001)
 *
 * Supports transports:
 *   "http"  — Streamable HTTP (single endpoint POST, modern MCP)
 *   "sse"   — Server-Sent Events (GET for SSE stream + POST for messages)
 *   "stdio" — Child process stdin/stdout (server-side subprocess)
 *
 * Feature-flagged under "mcp_dynamic_tools" — safe to import regardless.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { featureFlagsService } from "./feature-flags.js";
import { logger } from "../middleware/logger.js";
import type { Db } from "@paperclipai/db";
import type { McpTransportType } from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Constants (mirrored from Claude Code)
// ---------------------------------------------------------------------------

const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

// ---------------------------------------------------------------------------
// MCP protocol types (minimal subset needed)
// ---------------------------------------------------------------------------

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallToolResult {
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: number;
}

interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  result: T;
  id: number;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  error: { code: number; message: string; data?: unknown };
  id: number;
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError;

function isJsonRpcError<T>(r: JsonRpcResponse<T>): r is JsonRpcError {
  return "error" in r;
}

// ---------------------------------------------------------------------------
// Server config types
// ---------------------------------------------------------------------------

export interface McpHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface McpSseConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface McpStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpServerConfig =
  | ({ transportType: "http" } & McpHttpConfig)
  | ({ transportType: "sse" } & McpSseConfig)
  | ({ transportType: "stdio" } & McpStdioConfig);

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

export interface McpConnection {
  serverId: string;
  transportType: McpTransportType;
  /** Send a raw JSON-RPC request, returning the parsed result. */
  call<T>(method: string, params?: unknown): Promise<T>;
  /** Cleanly close the connection. */
  close(): Promise<void>;
  /** Whether the connection appears healthy. */
  isAlive(): boolean;
}

export type HealthStatus = "healthy" | "degraded" | "unreachable";

// ---------------------------------------------------------------------------
// HTTP-based connection (http + sse transports)
// ---------------------------------------------------------------------------

function makeHttpConnection(
  serverId: string,
  transportType: "http" | "sse",
  url: string,
  headers: Record<string, string> = {},
): McpConnection {
  let alive = true;
  let requestCounter = 0;
  let sessionId: string | null = null;

  async function call<T>(method: string, params?: unknown): Promise<T> {
    const id = ++requestCounter;
    const body: JsonRpcRequest = { jsonrpc: "2.0", method, id };
    if (params !== undefined) body.params = params;

    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    };
    if (sessionId) reqHeaders["mcp-session-id"] = sessionId;

    const endpoint = transportType === "sse" ? `${url}/message` : url;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(body),
    });

    // Capture session ID from response headers (modern MCP)
    const newSession = res.headers.get("mcp-session-id");
    if (newSession) sessionId = newSession;

    if (!res.ok) {
      // Session expired (Claude Code isMcpSessionExpiredError pattern)
      if (res.status === 404) {
        sessionId = null; // clear and let caller retry
        throw new McpSessionExpiredError(`Session expired for server ${serverId}`);
      }
      throw new Error(`MCP HTTP error ${res.status} for ${method}`);
    }

    const json = (await res.json()) as JsonRpcResponse<T>;
    if (isJsonRpcError(json)) {
      // JSON-RPC -32001 = session not found (Claude Code pattern)
      if (json.error.code === -32001) {
        sessionId = null;
        throw new McpSessionExpiredError(`Session not found for server ${serverId}`);
      }
      throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    }
    return (json as JsonRpcSuccess<T>).result;
  }

  return {
    serverId,
    transportType,
    call,
    close: async () => { alive = false; },
    isAlive: () => alive,
  };
}

// ---------------------------------------------------------------------------
// Stdio-based connection
// ---------------------------------------------------------------------------

function makeStdioConnection(
  serverId: string,
  command: string,
  args: string[],
  env: Record<string, string>,
): McpConnection {
  let child: ChildProcess | null = null;
  let requestCounter = 0;
  const pendingRequests = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();
  let alive = false;
  let lineBuffer = "";

  function start(): void {
    child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    alive = true;

    child.stdout?.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse<unknown>;
          const pending = pendingRequests.get(msg.id as number);
          if (!pending) continue;
          pendingRequests.delete(msg.id as number);
          if (isJsonRpcError(msg)) {
            pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            pending.resolve((msg as JsonRpcSuccess<unknown>).result);
          }
        } catch {
          // ignore malformed lines
        }
      }
    });

    child.on("exit", () => {
      alive = false;
      for (const { reject } of pendingRequests.values()) {
        reject(new Error(`MCP stdio process exited for server ${serverId}`));
      }
      pendingRequests.clear();
    });
  }

  start();

  return {
    serverId,
    transportType: "stdio",
    call: async <T>(method: string, params?: unknown): Promise<T> => {
      if (!alive || !child?.stdin) throw new Error(`Stdio MCP process not running for ${serverId}`);
      const id = ++requestCounter;
      const body: JsonRpcRequest = { jsonrpc: "2.0", method, id };
      if (params !== undefined) body.params = params;
      return new Promise<T>((resolve, reject) => {
        pendingRequests.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
        });
        child!.stdin!.write(JSON.stringify(body) + "\n");
      });
    },
    close: async () => {
      alive = false;
      child?.kill();
      child = null;
    },
    isAlive: () => alive,
  };
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class McpSessionExpiredError extends Error {
  constructor(msg: string) { super(msg); this.name = "McpSessionExpiredError"; }
}

export class McpConnectionError extends Error {
  constructor(msg: string) { super(msg); this.name = "McpConnectionError"; }
}

// ---------------------------------------------------------------------------
// MCP Session Service
// ---------------------------------------------------------------------------

export function mcpSessionService(_db: Db) {
  const log = logger.child({ service: "mcp-session" });

  /** In-memory connection pool: serverId → McpConnection */
  const pool = new Map<string, McpConnection>();

  /**
   * Get or create a connection to the given MCP server config.
   * Reuses existing connection when available (memoization pattern from Claude Code).
   */
  async function getOrCreate(
    serverId: string,
    config: McpServerConfig,
  ): Promise<McpConnection> {
    const existing = pool.get(serverId);
    if (existing?.isAlive()) return existing;

    const conn = await createConnection(serverId, config);
    pool.set(serverId, conn);
    return conn;
  }

  async function createConnection(
    serverId: string,
    config: McpServerConfig,
  ): Promise<McpConnection> {
    switch (config.transportType) {
      case "http":
        return makeHttpConnection(serverId, "http", config.url, config.headers);
      case "sse":
        return makeHttpConnection(serverId, "sse", config.url, config.headers);
      case "stdio":
        return makeStdioConnection(serverId, config.command, config.args ?? [], config.env ?? {});
      default: {
        const _exhaustive: never = config;
        throw new Error(`Unknown MCP transport type: ${(_exhaustive as McpServerConfig).transportType}`);
      }
    }
  }

  /**
   * Initialize MCP connection handshake (protocol negotiation).
   * Claude Code calls initialize() before any tool usage.
   */
  async function initialize(conn: McpConnection): Promise<void> {
    try {
      await conn.call<unknown>("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        clientInfo: { name: "paperclip", version: "1.0" },
      });
      // Send initialized notification
      await conn.call<unknown>("notifications/initialized", undefined).catch(() => {
        // Notification may not have a response — ignore error
      });
    } catch (err) {
      // Some servers don't require initialize (older MCP) — log and continue
      log.debug({ serverId: conn.serverId, err }, "MCP initialize failed (may be optional)");
    }
  }

  /**
   * Discover tools from an MCP server.
   * Calls tools/list RPC → returns McpToolDefinition[].
   */
  async function listTools(conn: McpConnection): Promise<McpToolDefinition[]> {
    const result = await conn.call<{ tools?: McpToolDefinition[] }>("tools/list");
    return result.tools ?? [];
  }

  /**
   * Execute a tool on the MCP server.
   * Calls tools/call RPC.
   */
  async function callTool(
    conn: McpConnection,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallToolResult> {
    return conn.call<McpCallToolResult>("tools/call", {
      name: toolName,
      arguments: args,
    });
  }

  /**
   * Health check — try a lightweight ping.
   * Claude Code pattern: detect liveness before surfacing to agents.
   */
  async function healthCheck(serverId: string): Promise<HealthStatus> {
    const conn = pool.get(serverId);
    if (!conn || !conn.isAlive()) return "unreachable";
    try {
      await conn.call<unknown>("ping", undefined).catch(() => {
        // ping may not be supported — try tools/list as fallback
      });
      return "healthy";
    } catch {
      return "degraded";
    }
  }

  /**
   * Reconnect with exponential backoff.
   * Claude Code: MAX_RECONNECT_ATTEMPTS=5, 1s→30s backoff.
   */
  async function reconnect(serverId: string, config: McpServerConfig): Promise<McpConnection | null> {
    const old = pool.get(serverId);
    if (old) await old.close().catch(() => {});
    pool.delete(serverId);

    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      const backoff = Math.min(INITIAL_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      log.debug({ serverId, attempt, backoffMs: backoff }, "MCP reconnect attempt");
      await new Promise((r) => setTimeout(r, backoff));
      try {
        const conn = await createConnection(serverId, config);
        await initialize(conn);
        pool.set(serverId, conn);
        log.info({ serverId, attempt }, "MCP reconnected");
        return conn;
      } catch (err) {
        log.warn({ serverId, attempt, err }, "MCP reconnect failed");
      }
    }

    log.error({ serverId }, "MCP reconnect exhausted all attempts");
    return null;
  }

  /**
   * Close all connections (called on server shutdown).
   */
  async function teardownAll(): Promise<void> {
    const closeAll = Array.from(pool.values()).map((c) => c.close().catch(() => {}));
    await Promise.all(closeAll);
    pool.clear();
  }

  return {
    isEnabled: async () => featureFlagsService(_db).isEnabled("mcp_dynamic_tools"),
    getOrCreate,
    initialize,
    listTools,
    callTool,
    healthCheck,
    reconnect,
    teardownAll,
  };
}

export type McpSessionServiceType = ReturnType<typeof mcpSessionService>;
