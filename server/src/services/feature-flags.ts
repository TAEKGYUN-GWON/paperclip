/**
 * feature-flags.ts
 * Phase 17: Instance-level feature flag system
 *
 * Flags are stored in instanceSettings.experimental.featureFlags (JSONB).
 * All flags default to false (opt-in). Operators enable flags via the
 * instance settings API without redeployment.
 *
 * Usage:
 *   const flags = featureFlagsService(db);
 *   if (await flags.isEnabled("coordinator_mode")) { ... }
 */

import type { Db } from "@paperclipai/db";
import { instanceSettingsService } from "./instance-settings.js";

// ──────────────────────────────────────────────────────────────────────────────
// Flag registry — all known feature keys (Phase 9-22 roadmap)
// ──────────────────────────────────────────────────────────────────────────────

export type FeatureFlagKey =
  | "context_compression"     // Phase 9:  3-tier context compression (snip/compact/rotate)
  | "streaming_feedback"      // Phase 14: real-time run progress streaming
  | "message_bus"             // Phase 18: structured agent-to-agent message bus
  | "task_graph"              // Phase 12: issue dependency graph + topological sort
  | "dream_task"              // Phase 15: KAIROS background memory consolidation
  | "coordinator_mode"        // Phase 19: coordinator/worker multi-agent orchestration
  | "auto_claim"              // Phase 11: autonomous idle-agent task claiming
  | "worktree_isolation"      // Phase 22: git worktree isolation per worker
  | "permission_delegation"   // Phase 21: worker → coordinator → user permission flow
  | "declarative_workflows"   // Phase 13: YAML-defined multi-agent pipelines
  | "mcp_dynamic_tools"       // Phase 16: runtime MCP tool registration
  | "remote_planning"         // Phase 20: ULTRAPLAN remote planning offload
  | "ceo_chat";               // CEO Chat: CEO 1:1 채팅, 선제적 브리핑, 단체 톡방

// Default state for every flag (false = feature is off until explicitly enabled)
const FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  context_compression: false,
  streaming_feedback: false,
  message_bus: false,
  task_graph: false,
  dream_task: false,
  coordinator_mode: false,
  auto_claim: false,
  worktree_isolation: false,
  permission_delegation: false,
  declarative_workflows: false,
  mcp_dynamic_tools: false,
  remote_planning: false,
  ceo_chat: false,
};

// ──────────────────────────────────────────────────────────────────────────────
// Pure evaluation helper (used directly in tests without DB)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates a single flag against a stored flags map.
 * Falls back to FLAG_DEFAULTS when the key is absent.
 */
export function evaluateFlag(
  key: FeatureFlagKey,
  storedFlags: Record<string, boolean> | null | undefined,
): boolean {
  if (storedFlags && key in storedFlags) return storedFlags[key]!;
  return FLAG_DEFAULTS[key] ?? false;
}

/**
 * Merges stored flags with FLAG_DEFAULTS, returning a complete snapshot
 * of all known flags with their effective values.
 */
export function evaluateAllFlags(
  storedFlags: Record<string, boolean> | null | undefined,
): Record<FeatureFlagKey, boolean> {
  const result = { ...FLAG_DEFAULTS };
  if (storedFlags) {
    for (const key of Object.keys(FLAG_DEFAULTS) as FeatureFlagKey[]) {
      if (key in storedFlags) result[key] = storedFlags[key]!;
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// Service factory
// ──────────────────────────────────────────────────────────────────────────────

export function featureFlagsService(db: Db) {
  const settings = instanceSettingsService(db);

  async function getStoredFlags(): Promise<Record<string, boolean>> {
    const experimental = await settings.getExperimental();
    return experimental.featureFlags ?? {};
  }

  return {
    /**
     * Returns true if the flag is enabled in instance settings.
     * Defaults to false for unset flags.
     */
    isEnabled: async (key: FeatureFlagKey): Promise<boolean> => {
      return evaluateFlag(key, await getStoredFlags());
    },

    /**
     * Enables or disables a single flag, merging with existing stored flags.
     */
    setFlag: async (key: FeatureFlagKey, enabled: boolean): Promise<void> => {
      const stored = await getStoredFlags();
      await settings.updateExperimental({
        featureFlags: { ...stored, [key]: enabled },
      });
    },

    /**
     * Returns a full snapshot of all known flags with their effective values.
     */
    getAllFlags: async (): Promise<Record<FeatureFlagKey, boolean>> => {
      return evaluateAllFlags(await getStoredFlags());
    },

    /**
     * Resets a flag to its default value by removing it from stored overrides.
     */
    resetFlag: async (key: FeatureFlagKey): Promise<void> => {
      const stored = await getStoredFlags();
      const updated = { ...stored };
      delete updated[key];
      await settings.updateExperimental({ featureFlags: updated });
    },
  };
}
