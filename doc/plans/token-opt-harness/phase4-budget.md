# Phase 4: 도구 결과 버젯팅

> **이 파일은 Claude Code 서브에이전트가 단독으로 읽고 실행하는 자기완결적 작업 지침입니다.**
> **선행 조건 없음 — 다른 Phase와 병렬 실행 가능**
> 완료 조건: 모든 파일 생성/수정 + `pnpm typecheck` + `pnpm test` 통과

## 목적

도구 결과(이슈 코멘트, 워크스페이스 로그, 핸드오프 데이터)에
토큰 예산을 적용하여 큰 출력이 컨텍스트를 압도하는 것을 방지합니다.

예상 효과: 도구 집약적 워크플로우에서 15–30% 절감

---

## 컨텍스트 읽기 (시작 전 필수)

```
read_file packages/adapter-utils/src/index.ts
read_file server/src/services/heartbeat.ts   # 컨텍스트 스냅샷 빌드 위치 확인
```

---

## 작업 1: 신규 파일 생성

### `packages/adapter-utils/src/tool-result-budget.ts`

```typescript
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
```

---

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
```

---

## 작업 2: `packages/adapter-utils/src/tool-result-budget.test.ts` 생성

```typescript
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
```

---

## 작업 3: `packages/adapter-utils/src/index.ts` — export 추가

```typescript
export {
  truncateToTokenBudget,
  ToolResultBudgetTracker,
  DEFAULT_TOOL_RESULT_BUDGET,
} from "./tool-result-budget.js";
export type { ToolResultBudget } from "./tool-result-budget.js";
```

---

## 작업 4: `server/src/services/heartbeat.ts` — 버젯 적용

컨텍스트 스냅샷 빌드 시 이슈 코멘트와 워크스페이스 로그에 버젯을 적용합니다.

먼저 heartbeat.ts에서 이슈 코멘트 조합 부분과 로그 처리 부분을 찾은 후:

```typescript
import { ToolResultBudgetTracker } from "@paperclipai/adapter-utils";

// 컨텍스트 스냅샷 빌드 시작 시 트래커 초기화
const budgetTracker = new ToolResultBudgetTracker({
  maxSingleResultTokens: 8_000,
  maxAggregateResultTokens: 40_000,
  truncationStrategy: "tail",
});

// 이슈 코멘트 처리 시
const truncatedComments = issueComments.map((comment) => ({
  ...comment,
  body: budgetTracker.truncateIfNeeded(comment.body ?? ""),
}));

// 워크스페이스 로그 처리 시
const truncatedLog = budgetTracker.truncateIfNeeded(workspaceOperationLog ?? "");
```

> **참고**: 실제 변수명은 heartbeat.ts를 먼저 읽어 확인하세요.
> `issueComments`, `workspaceOperationLog` 등은 예시 이름입니다.

---

## 완료 확인

```sh
pnpm typecheck
pnpm test --filter @paperclipai/adapter-utils
```
