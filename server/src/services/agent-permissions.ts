/**
 * agent-permissions.ts
 * Phase 21: Agent permission model
 *
 * Extends the original single-permission model with granular tool-level
 * permission types used by the permission delegation protocol.
 */

import type { PermissionType } from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Legacy model (canCreateAgents) — kept for backward compatibility
// ---------------------------------------------------------------------------

export type NormalizedAgentPermissions = Record<string, unknown> & {
  canCreateAgents: boolean;
};

export function defaultPermissionsForRole(role: string): NormalizedAgentPermissions {
  return {
    canCreateAgents: role === "ceo",
  };
}

export function normalizeAgentPermissions(
  permissions: unknown,
  role: string,
): NormalizedAgentPermissions {
  const defaults = defaultPermissionsForRole(role);
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return defaults;
  }

  const record = permissions as Record<string, unknown>;
  return {
    canCreateAgents:
      typeof record.canCreateAgents === "boolean"
        ? record.canCreateAgents
        : defaults.canCreateAgents,
  };
}

// ---------------------------------------------------------------------------
// Phase 21: Granular tool-permission profile
// ---------------------------------------------------------------------------

/**
 * Permission profile for a coordinator worker agent.
 * Controls which tool-level actions require escalation through the
 * Worker → Coordinator → User delegation chain.
 */
export interface WorkerPermissionProfile {
  /** Approved without escalation — worker can use these freely. */
  preApproved: PermissionType[];
  /** Explicitly denied — escalation is not possible. */
  denied: PermissionType[];
  /**
   * All permission types not listed in preApproved or denied will require
   * escalation. This list is informational (the service computes it at runtime).
   */
  requiresEscalation?: PermissionType[];
}

/** Default profile: safe read-only operations pre-approved; destructive ops require escalation. */
export const DEFAULT_WORKER_PERMISSION_PROFILE: WorkerPermissionProfile = {
  preApproved: [],          // Nothing pre-approved by default — all ops need escalation
  denied: [],               // Nothing permanently denied by default
};

/** Resolve the effective profile for a worker, merging agent config overrides with defaults. */
export function resolveWorkerPermissionProfile(
  agentRuntimeConfig: Record<string, unknown> | null | undefined,
): WorkerPermissionProfile {
  if (
    typeof agentRuntimeConfig?.permissionProfile !== "object" ||
    agentRuntimeConfig.permissionProfile === null
  ) {
    return DEFAULT_WORKER_PERMISSION_PROFILE;
  }

  const raw = agentRuntimeConfig.permissionProfile as Record<string, unknown>;
  const preApproved = Array.isArray(raw.preApproved)
    ? (raw.preApproved.filter((v): v is PermissionType => typeof v === "string"))
    : DEFAULT_WORKER_PERMISSION_PROFILE.preApproved;
  const denied = Array.isArray(raw.denied)
    ? (raw.denied.filter((v): v is PermissionType => typeof v === "string"))
    : DEFAULT_WORKER_PERMISSION_PROFILE.denied;

  return { preApproved, denied };
}

/**
 * Map a tool name (as sent by an adapter) to a PermissionType category.
 * Returns null when the tool does not map to a permission-controlled action.
 */
export function toolNameToPermissionType(toolName: string): PermissionType | null {
  const lower = toolName.toLowerCase();

  // Bash / shell execution
  if (lower === "bash" || lower === "shell" || lower === "execute") return "bash_execute";

  // File operations
  if (lower === "write" || lower === "writefile") return "file_write";
  if (lower === "delete" || lower === "deletefile" || lower === "remove") return "file_delete";

  // Git
  if (lower === "gitpush" || lower === "git_push") return "git_push";

  // Network
  if (lower === "fetch" || lower === "webfetch" || lower === "websearch") return "network_access";

  // Package install
  if (lower === "install" || lower === "npminstall" || lower === "pipinstall") return "tool_install";

  // DB mutations (plugin tools that write to DB)
  if (lower.includes("db_write") || lower.includes("database_write")) return "db_write";

  // MCP tools (namespaced "mcp.server:tool")
  if (lower.startsWith("mcp.") || lower.startsWith("mcp_")) return "mcp_tool_use";

  return null;
}
