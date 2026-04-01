/**
 * feature-flags.test.ts
 * Phase 17: Feature flag system unit tests
 *
 * evaluateFlag / evaluateAllFlags are pure functions — tested without DB.
 * featureFlagsService DB integration is covered via mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluateFlag,
  evaluateAllFlags,
  featureFlagsService,
  type FeatureFlagKey,
} from "./feature-flags.js";
import * as instanceSettingsModule from "./instance-settings.js";

// ──────────────────────────────────────────────────────────────────────────────
// Pure evaluation helpers
// ──────────────────────────────────────────────────────────────────────────────

describe("evaluateFlag", () => {
  it("returns false for an unset flag (default)", () => {
    expect(evaluateFlag("coordinator_mode", {})).toBe(false);
    expect(evaluateFlag("coordinator_mode", null)).toBe(false);
    expect(evaluateFlag("coordinator_mode", undefined)).toBe(false);
  });

  it("returns stored value when flag is explicitly set to true", () => {
    expect(evaluateFlag("coordinator_mode", { coordinator_mode: true })).toBe(true);
  });

  it("returns stored value when flag is explicitly set to false", () => {
    expect(evaluateFlag("dream_task", { dream_task: false })).toBe(false);
  });

  it("ignores unrelated stored keys", () => {
    expect(evaluateFlag("message_bus", { some_other_flag: true })).toBe(false);
  });
});

describe("evaluateAllFlags", () => {
  it("returns all false by default with empty stored flags", () => {
    const all = evaluateAllFlags({});
    for (const val of Object.values(all)) {
      expect(val).toBe(false);
    }
  });

  it("merges stored overrides into defaults", () => {
    const all = evaluateAllFlags({ coordinator_mode: true, dream_task: true });
    expect(all.coordinator_mode).toBe(true);
    expect(all.dream_task).toBe(true);
    expect(all.message_bus).toBe(false);
  });

  it("ignores stored keys not in known flag registry", () => {
    const all = evaluateAllFlags({ unknown_future_flag: true } as Record<string, boolean>);
    // unknown key must not bleed into result
    expect("unknown_future_flag" in all).toBe(false);
  });

  it("returns correct count of known flags", () => {
    const all = evaluateAllFlags(null);
    // 12 known flags in the registry
    expect(Object.keys(all)).toHaveLength(12);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// featureFlagsService (DB-backed)
// ──────────────────────────────────────────────────────────────────────────────

vi.mock("./instance-settings.js");

describe("featureFlagsService", () => {
  const mockGetExperimental = vi.fn();
  const mockUpdateExperimental = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(instanceSettingsModule.instanceSettingsService).mockReturnValue({
      getExperimental: mockGetExperimental,
      updateExperimental: mockUpdateExperimental,
      get: vi.fn(),
      getGeneral: vi.fn(),
      updateGeneral: vi.fn(),
      listCompanyIds: vi.fn(),
    });
    mockGetExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
      featureFlags: undefined,
    });
    mockUpdateExperimental.mockResolvedValue({});
  });

  it("isEnabled returns false for unset flag", async () => {
    const svc = featureFlagsService({} as never);
    expect(await svc.isEnabled("coordinator_mode")).toBe(false);
  });

  it("isEnabled returns true when flag is stored as true", async () => {
    mockGetExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
      featureFlags: { coordinator_mode: true },
    });
    const svc = featureFlagsService({} as never);
    expect(await svc.isEnabled("coordinator_mode")).toBe(true);
  });

  it("isEnabled returns false when flag is stored as false", async () => {
    mockGetExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
      featureFlags: { dream_task: false },
    });
    const svc = featureFlagsService({} as never);
    expect(await svc.isEnabled("dream_task")).toBe(false);
  });

  it("setFlag writes merged flags to instance settings", async () => {
    mockGetExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
      featureFlags: { message_bus: true },
    });
    const svc = featureFlagsService({} as never);
    await svc.setFlag("coordinator_mode", true);

    expect(mockUpdateExperimental).toHaveBeenCalledWith({
      featureFlags: { message_bus: true, coordinator_mode: true },
    });
  });

  it("setFlag does not overwrite existing flags", async () => {
    mockGetExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
      featureFlags: { streaming_feedback: true, task_graph: true },
    });
    const svc = featureFlagsService({} as never);
    await svc.setFlag("dream_task", true);

    const written = mockUpdateExperimental.mock.calls[0]?.[0] as { featureFlags: Record<string, boolean> };
    expect(written.featureFlags.streaming_feedback).toBe(true);
    expect(written.featureFlags.task_graph).toBe(true);
    expect(written.featureFlags.dream_task).toBe(true);
  });

  it("getAllFlags returns complete snapshot with defaults", async () => {
    mockGetExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
      featureFlags: { coordinator_mode: true },
    });
    const svc = featureFlagsService({} as never);
    const all = await svc.getAllFlags();
    expect(all.coordinator_mode).toBe(true);
    expect(all.dream_task).toBe(false);
  });

  it("resetFlag removes key from stored flags", async () => {
    mockGetExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
      featureFlags: { coordinator_mode: true, message_bus: true },
    });
    const svc = featureFlagsService({} as never);
    await svc.resetFlag("coordinator_mode");

    const written = mockUpdateExperimental.mock.calls[0]?.[0] as { featureFlags: Record<string, boolean> };
    expect("coordinator_mode" in written.featureFlags).toBe(false);
    expect(written.featureFlags.message_bus).toBe(true);
  });
});
