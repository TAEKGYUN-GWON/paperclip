/**
 * permission-delegation.ts
 * Phase 21: Permission Delegation Protocol
 *
 * Implements Worker → Coordinator → User permission escalation.
 * Adapted from Claude Code swarm/permissionSync.ts:
 *   - File-based pending/resolved dirs → DB permission_requests table
 *   - pollForResponse() → message bus direct notification
 *   - TTL cleanup → expiresAt field + cleanupExpired()
 *
 * Feature-flagged under "permission_delegation" — safe to import regardless.
 */

import { and, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { permissionRequests } from "@paperclipai/db";
import type {
  PermissionType,
  PermissionRequestStatus,
  DelegationScope,
} from "@paperclipai/shared";
import { featureFlagsService } from "./feature-flags.js";
import { messageBusService } from "./message-bus.js";
import {
  resolveWorkerPermissionProfile,
  toolNameToPermissionType,
} from "./agent-permissions.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PermissionCheckInput {
  companyId: string;
  workerAgentId: string;
  toolName: string;
  /** runtimeConfig from agent row — contains permissionProfile if set. */
  agentRuntimeConfig?: Record<string, unknown> | null;
  /** Active session grants accumulated during this coordinator session. */
  sessionGrants?: Set<PermissionType>;
}

export type PermissionCheckResult = "allowed" | "denied" | "needs_escalation";

export interface RequestPermissionInput {
  companyId: string;
  coordinatorSessionId: string;
  workerAgentId: string;
  coordinatorAgentId: string;
  toolName: string;
  permissionType: PermissionType;
  description: string;
  toolInput?: Record<string, unknown>;
  /** TTL in seconds; defaults to 30 minutes (Claude Code default). */
  ttlSeconds?: number;
}

export interface PermissionResolution {
  decision: "approved" | "rejected";
  feedback?: string;
  /** Modified tool input if the resolver changed parameters. */
  updatedInput?: Record<string, unknown>;
  /** How long this grant lasts (set when approved). */
  grantScope?: DelegationScope;
}

export type PermissionRequest = typeof permissionRequests.$inferSelect;

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

/** Default TTL before an unresolved request auto-expires (30 min). */
const DEFAULT_TTL_SECONDS = 30 * 60;

export function permissionDelegationService(db: Db) {
  const flags = featureFlagsService(db);
  const msgBus = messageBusService(db);

  async function isEnabled(): Promise<boolean> {
    return flags.isEnabled("permission_delegation");
  }

  /**
   * Determine whether a worker agent can use a tool without escalation.
   *
   * Returns:
   *   "allowed"           — pre-approved by profile or session grant
   *   "denied"            — explicitly blocked (no escalation possible)
   *   "needs_escalation"  — requires coordinator / user approval
   */
  function checkPermission(input: PermissionCheckInput): PermissionCheckResult {
    const permType = toolNameToPermissionType(input.toolName);

    // Tools that don't map to a controlled permission type are freely allowed.
    if (permType === null) return "allowed";

    const profile = resolveWorkerPermissionProfile(input.agentRuntimeConfig ?? null);

    if (profile.denied.includes(permType)) return "denied";
    if (profile.preApproved.includes(permType)) return "allowed";
    if (input.sessionGrants?.has(permType)) return "allowed";

    return "needs_escalation";
  }

  /**
   * Create a new permission escalation request and notify the coordinator
   * via the message bus (direct, priority=0 "now").
   */
  async function requestPermission(input: RequestPermissionInput): Promise<PermissionRequest> {
    const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttl * 1_000);

    const [record] = await db
      .insert(permissionRequests)
      .values({
        companyId: input.companyId,
        coordinatorSessionId: input.coordinatorSessionId,
        workerAgentId: input.workerAgentId,
        toolName: input.toolName,
        permissionType: input.permissionType,
        description: input.description,
        toolInput: input.toolInput ?? {},
        status: "pending",
        expiresAt,
      })
      .returning();

    if (!record) throw new Error("Failed to create permission request");

    // Notify coordinator via message bus (now = priority 0)
    const busDependencySatisfied = await msgBus.isEnabled();
    if (busDependencySatisfied) {
      await msgBus.send({
        companyId: input.companyId,
        fromAgentId: input.workerAgentId,
        toAgentId: input.coordinatorAgentId,
        mode: "direct",
        priority: 0, // "now" — urgent
        type: "request",
        subject: `permission_request:${record.id}`,
        body: JSON.stringify({
          permissionRequestId: record.id,
          toolName: input.toolName,
          permissionType: input.permissionType,
          description: input.description,
        }),
        ttlSeconds: ttl,
      });
    }

    return record;
  }

  /**
   * Resolve a permission request (approve or reject) and notify the worker.
   * Called by the coordinator agent or a human user.
   */
  async function resolvePermission(
    requestId: string,
    resolution: PermissionResolution,
    resolver: { agentId?: string; userId?: string },
  ): Promise<PermissionRequest> {
    const now = new Date();

    const [updated] = await db
      .update(permissionRequests)
      .set({
        status: resolution.decision,
        resolverAgentId: resolver.agentId ?? null,
        resolverUserId: resolver.userId ?? null,
        feedback: resolution.feedback ?? null,
        updatedInput: resolution.updatedInput ?? null,
        grantScope: resolution.grantScope ?? null,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(permissionRequests.id, requestId),
          inArray(permissionRequests.status, ["pending"]),
        ),
      )
      .returning();

    if (!updated) {
      // Already resolved — return current state
      const existing = await db
        .select()
        .from(permissionRequests)
        .where(eq(permissionRequests.id, requestId))
        .then((rows) => rows[0] ?? null);
      if (!existing) throw new Error(`Permission request ${requestId} not found`);
      return existing;
    }

    // Notify the worker of the outcome via message bus
    const busDependencySatisfied = await msgBus.isEnabled();
    if (busDependencySatisfied && resolver.agentId) {
      await msgBus.send({
        companyId: updated.companyId,
        fromAgentId: resolver.agentId,
        toAgentId: updated.workerAgentId,
        mode: "direct",
        priority: 0, // "now"
        type: "response",
        subject: `permission_response:${requestId}`,
        body: JSON.stringify({
          permissionRequestId: requestId,
          decision: resolution.decision,
          feedback: resolution.feedback,
          updatedInput: resolution.updatedInput,
          grantScope: resolution.grantScope,
        }),
        ttlSeconds: 300, // 5 min for the worker to pick up
      });
    }

    return updated;
  }

  /**
   * Retrieve a permission request by ID (for worker polling / coordinator review).
   */
  async function getRequest(requestId: string): Promise<PermissionRequest | null> {
    return db
      .select()
      .from(permissionRequests)
      .where(eq(permissionRequests.id, requestId))
      .then((rows) => rows[0] ?? null);
  }

  /**
   * List all pending permission requests for a coordinator session.
   * Used by the coordinator agent to surface outstanding decisions.
   */
  async function listPendingForSession(
    companyId: string,
    coordinatorSessionId: string,
  ): Promise<PermissionRequest[]> {
    return db
      .select()
      .from(permissionRequests)
      .where(
        and(
          eq(permissionRequests.companyId, companyId),
          eq(permissionRequests.coordinatorSessionId, coordinatorSessionId),
          eq(permissionRequests.status, "pending"),
        ),
      );
  }

  /**
   * Mark all expired pending requests as "expired".
   * Should be called periodically (e.g., maintenance job or heartbeat sweep).
   * Returns the count of requests expired.
   */
  async function cleanupExpired(companyId: string): Promise<number> {
    const now = new Date();
    const result = await db
      .update(permissionRequests)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(permissionRequests.companyId, companyId),
          eq(permissionRequests.status, "pending"),
          lt(permissionRequests.expiresAt, now),
        ),
      )
      .returning({ id: permissionRequests.id });

    return result.length;
  }

  /**
   * Build a context string summarising pending permission requests for injection
   * into the coordinator agent's system prompt.
   */
  function buildPendingPermissionsContext(pending: PermissionRequest[]): string {
    if (pending.length === 0) return "";

    const lines = pending.map((req) => {
      const age = Math.round((Date.now() - req.createdAt.getTime()) / 1_000);
      return `  - [${req.id}] Worker ${req.workerAgentId} requests "${req.toolName}" (${req.permissionType}): ${req.description} (${age}s ago)`;
    });

    return [
      "<pending-permission-requests>",
      "The following worker agents are waiting for your permission decision:",
      ...lines,
      "Use resolvePermission() or the /api/coordinator/permissions endpoint to approve or reject.",
      "</pending-permission-requests>",
    ].join("\n");
  }

  return {
    isEnabled,
    checkPermission,
    requestPermission,
    resolvePermission,
    getRequest,
    listPendingForSession,
    cleanupExpired,
    buildPendingPermissionsContext,
  };
}
