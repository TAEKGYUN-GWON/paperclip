import { describe, it, expect } from "vitest";
import {
  truncateToTokenBudget,
  ToolResultBudgetTracker,
  DEFAULT_TOOL_RESULT_BUDGET,
} from "./tool-result-budget.js";

describe("truncateToTokenBudget", () => {
  it("예산 내 텍스트는 변경 없음", () => {
    const text = "hello world"; // ~3토큰
    expect(truncateToTokenBudget(text, 100)).toBe(text);
  });

  it("tail 전략: 앞부분 보존 + 생략 안내", () => {
    const text = "a".repeat(400); // ~100토큰
    const result = truncateToTokenBudget(text, 10, "tail"); // 40자 유지
    expect(result).toContain("[버젯 초과로");
    expect(result.length).toBeLessThan(text.length);
  });

  it("head_tail 전략: 앞뒤 보존 + 중간 생략", () => {
    const text = "START" + "x".repeat(400) + "END";
    const result = truncateToTokenBudget(text, 10, "head_tail");
    expect(result).toContain("START");
    expect(result).toContain("END");
    expect(result).toContain("[중간");
  });
});

describe("ToolResultBudgetTracker", () => {
  it("단일 결과 예산 내 → 그대로 반환", () => {
    const tracker = new ToolResultBudgetTracker({ maxSingleResultTokens: 1000 });
    const short = "hello"; // ~2토큰
    expect(tracker.truncateIfNeeded(short)).toBe(short);
  });

  it("집계 예산 초과 시 isAggregateExceeded = true", () => {
    const tracker = new ToolResultBudgetTracker({
      maxSingleResultTokens: 100,
      maxAggregateResultTokens: 10,
    });
    const text = "x".repeat(200); // 집계 예산 초과
    tracker.truncateIfNeeded(text);
    expect(tracker.isAggregateExceeded()).toBe(true);
  });

  it("getAggregateUsage 누적 동작", () => {
    const tracker = new ToolResultBudgetTracker();
    tracker.truncateIfNeeded("hello world"); // ~3토큰
    expect(tracker.getAggregateUsage()).toBeGreaterThan(0);
  });
});

describe("DEFAULT_TOOL_RESULT_BUDGET", () => {
  it("기본 예산 값 확인", () => {
    expect(DEFAULT_TOOL_RESULT_BUDGET.maxSingleResultTokens).toBe(8_000);
    expect(DEFAULT_TOOL_RESULT_BUDGET.maxAggregateResultTokens).toBe(40_000);
    expect(DEFAULT_TOOL_RESULT_BUDGET.truncationStrategy).toBe("tail");
  });
});
