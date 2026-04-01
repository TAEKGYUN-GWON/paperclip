/**
 * tool-result-budget.ts
 * 도구 결과 토큰 예산 관리 — Claude Code 패턴 적용
 *
 * 단일 도구 결과와 집계 도구 결과 모두에 상한을 두어
 * 대용량 출력이 컨텍스트를 압도하지 않도록 합니다.
 */

/** 토큰 예산 설정 */
export interface ToolResultBudget {
  /** 단일 도구 결과 최대 토큰 수 (기본 8,000) */
  maxSingleResultTokens: number;
  /** 세션 내 도구 결과 집계 최대 토큰 수 (기본 40,000) */
  maxAggregateResultTokens: number;
  /** 트렁케이션 전략 */
  truncationStrategy: "tail" | "head_tail" | "summarize";
}

/** 기본 예산 설정 */
export const DEFAULT_TOOL_RESULT_BUDGET: ToolResultBudget = {
  maxSingleResultTokens: 8_000,
  maxAggregateResultTokens: 40_000,
  truncationStrategy: "tail",
};

/**
 * 텍스트를 토큰 상한에 맞게 트렁케이션합니다.
 * 토큰 추정: 영문 기준 4자 ≈ 1토큰 (보수적 추정)
 *
 * @param content  - 원본 텍스트
 * @param maxTokens - 최대 허용 토큰 수
 * @param strategy  - 트렁케이션 전략
 * @returns 트렁케이션된 텍스트
 */
export function truncateToTokenBudget(
  content: string,
  maxTokens: number,
  strategy: ToolResultBudget["truncationStrategy"] = "tail",
): string {
  // 보수적 토큰 추정: 4자 = 1토큰
  const estimatedTokens = Math.ceil(content.length / 4);
  if (estimatedTokens <= maxTokens) return content;

  const maxChars = maxTokens * 4;
  const notice = `\n...[버젯 초과로 ${content.length - maxChars}자 생략됨]`;

  if (strategy === "tail") {
    return content.slice(0, maxChars) + notice;
  }

  if (strategy === "head_tail") {
    const half = Math.floor(maxChars / 2);
    const head = content.slice(0, half);
    const tail = content.slice(content.length - half);
    return head + `\n...[중간 ${content.length - maxChars}자 생략됨]\n` + tail;
  }

  // "summarize": tail과 동일하게 처리 (실제 요약은 어댑터가 담당)
  return content.slice(0, maxChars) + notice;
}

/**
 * 도구 결과 토큰 예산 트래커
 * 세션 내 누적 사용량을 추적하고 집계 예산 초과 시 경고합니다.
 */
export class ToolResultBudgetTracker {
  private aggregateTokensUsed = 0;
  private readonly budget: ToolResultBudget;

  constructor(budget: Partial<ToolResultBudget> = {}) {
    this.budget = { ...DEFAULT_TOOL_RESULT_BUDGET, ...budget };
  }

  /**
   * 도구 결과를 예산 내로 트렁케이션합니다.
   * 집계 예산도 함께 추적합니다.
   *
   * @param content - 원본 도구 결과 텍스트
   * @returns 트렁케이션된 텍스트
   */
  truncateIfNeeded(content: string): string {
    const remaining = this.budget.maxAggregateResultTokens - this.aggregateTokensUsed;
    const effectiveMax = Math.min(this.budget.maxSingleResultTokens, Math.max(0, remaining));

    const truncated = truncateToTokenBudget(
      content,
      effectiveMax,
      this.budget.truncationStrategy,
    );

    const usedTokens = Math.ceil(truncated.length / 4);
    this.aggregateTokensUsed += usedTokens;

    return truncated;
  }

  /** 현재 누적 토큰 사용량 반환 */
  getAggregateUsage(): number {
    return this.aggregateTokensUsed;
  }

  /** 집계 예산 초과 여부 */
  isAggregateExceeded(): boolean {
    return this.aggregateTokensUsed >= this.budget.maxAggregateResultTokens;
  }
}
