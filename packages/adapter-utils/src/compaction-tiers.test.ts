import { describe, it, expect } from "vitest";
import {
  selectCompactionTier,
  getContextWindowTokens,
  ADAPTER_CONTEXT_WINDOW_TOKENS,
} from "./compaction-tiers.js";

describe("selectCompactionTier", () => {
  const window = 200_000;

  it("none: 70% 미만", () => {
    const result = selectCompactionTier(100_000, window); // 50%
    expect(result.tier).toBe("none");
    expect(result.utilizationPercent).toBe(50);
  });

  it("micro: 70% 이상 85% 미만", () => {
    const result = selectCompactionTier(150_000, window); // 75%
    expect(result.tier).toBe("micro");
  });

  it("auto: 85% 이상 95% 미만", () => {
    const result = selectCompactionTier(180_000, window); // 90%
    expect(result.tier).toBe("auto");
  });

  it("collapse: 95% 이상", () => {
    const result = selectCompactionTier(195_000, window); // 97.5%
    expect(result.tier).toBe("collapse");
  });

  it("contextWindowTokens=0 이면 none 반환", () => {
    const result = selectCompactionTier(999_999, 0);
    expect(result.tier).toBe("none");
  });
});

describe("getContextWindowTokens", () => {
  it("claude_local → 200_000", () => {
    expect(getContextWindowTokens("claude_local")).toBe(200_000);
  });

  it("gemini_local → 1_000_000", () => {
    expect(getContextWindowTokens("gemini_local")).toBe(1_000_000);
  });

  it("알 수 없는 어댑터 → 128_000", () => {
    expect(getContextWindowTokens("unknown_adapter")).toBe(128_000);
  });

  it("null → 128_000", () => {
    expect(getContextWindowTokens(null)).toBe(128_000);
  });
});
