# Phase 1: 멀티티어 세션 컴팩션

> **이 파일은 Claude Code 서브에이전트가 단독으로 읽고 실행하는 자기완결적 작업 지침입니다.**
> 완료 조건: 모든 파일 생성/수정 + `pnpm typecheck` + `pnpm test` 통과

## 목적

기존 `session-compaction.ts`의 단순 임계값 기반 회전(enabled/threshold)을
4단계 컴팩션 티어(none → micro → auto → collapse)로 확장합니다.

예상 효과: 장기 실행 세션 토큰 30–50% 절감

---

## 컨텍스트 읽기 (시작 전 필수)

```
read_file packages/adapter-utils/src/session-compaction.ts
read_file packages/adapter-utils/src/index.ts
read_file server/src/services/heartbeat.ts   # evaluateSessionCompaction 함수 위치 파악
```

---

## 작업 1: 신규 파일 생성

### `packages/adapter-utils/src/compaction-tiers.ts`

아래 내용 그대로 생성하세요.

```typescript
/**
 * compaction-tiers.ts
 * 멀티티어 세션 컴팩션 로직 — Claude Code 패턴 적용
 *
 * 컨텍스트 사용량에 따라 4단계 컴팩션 티어를 결정합니다.
 * heartbeat.ts의 evaluateSessionCompaction()에서 호출됩니다.
 */

/** 컴팩션 강도 티어 */
export type CompactionTier = "none" | "micro" | "auto" | "collapse";

/** 티어 결정 결과 */
export interface CompactionDecision {
  /** 결정된 컴팩션 티어 */
  tier: CompactionTier;
  /** 현재 컨텍스트 사용률 (0–100) */
  utilizationPercent: number;
  /** 결정 이유 */
  reason: string;
}

/** 컴팩션 실행 결과 */
export interface CompactionResult {
  /** 실행된 티어 */
  tier: CompactionTier;
  /** 생성된 핸드오프 요약 */
  summary: string;
  /** 복원할 핵심 파일 목록 (상위 5개) */
  criticalFiles: string[];
  /** 보존할 추가 컨텍스트 */
  preservedContext: Record<string, unknown>;
  /** 요약 후 예상 토큰 수 */
  tokenEstimate: number;
}

/**
 * 어댑터별 컨텍스트 윈도우 크기 (토큰)
 * claude/codex: 200k, gemini: 1M, 기타: 128k
 */
export const ADAPTER_CONTEXT_WINDOW_TOKENS: Record<string, number> = {
  claude_local: 200_000,
  codex_local: 200_000,
  gemini_local: 1_000_000,
  cursor: 128_000,
  opencode_local: 128_000,
  pi_local: 128_000,
};

/** 기본 컨텍스트 윈도우 (알 수 없는 어댑터) */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

/**
 * 컨텍스트 사용률에 따라 컴팩션 티어를 결정합니다.
 *
 * 티어 기준:
 *  - none    : 70% 미만 — 컴팩션 불필요
 *  - micro   : 70–85%  — 중복 코멘트 축약, 세션 유지
 *  - auto    : 85–95%  — 최근 런 요약 핸드오프, 세션 회전
 *  - collapse: 95% 이상 — 핵심 상태+목표만 남기는 극단적 요약, 세션 회전
 *
 * @param cumulativeInputTokens - 누적 입력 토큰 수
 * @param contextWindowTokens   - 어댑터의 컨텍스트 윈도우 크기
 */
export function selectCompactionTier(
  cumulativeInputTokens: number,
  contextWindowTokens: number,
): CompactionDecision {
  if (contextWindowTokens <= 0) {
    return { tier: "none", utilizationPercent: 0, reason: "컨텍스트 윈도우 크기 미설정" };
  }

  const utilizationPercent = Math.min(
    100,
    Math.round((cumulativeInputTokens / contextWindowTokens) * 100),
  );

  if (utilizationPercent >= 95) {
    return {
      tier: "collapse",
      utilizationPercent,
      reason: `컨텍스트 ${utilizationPercent}% 소진 — 극단적 요약 후 세션 회전`,
    };
  }
  if (utilizationPercent >= 85) {
    return {
      tier: "auto",
      utilizationPercent,
      reason: `컨텍스트 ${utilizationPercent}% 소진 — 핸드오프 생성 후 세션 회전`,
    };
  }
  if (utilizationPercent >= 70) {
    return {
      tier: "micro",
      utilizationPercent,
      reason: `컨텍스트 ${utilizationPercent}% 소진 — 중복 코멘트 축약, 세션 유지`,
    };
  }
  return {
    tier: "none",
    utilizationPercent,
    reason: `컨텍스트 ${utilizationPercent}% — 컴팩션 불필요`,
  };
}

/**
 * 어댑터 타입으로 컨텍스트 윈도우 크기를 반환합니다.
 */
export function getContextWindowTokens(adapterType: string | null | undefined): number {
  if (!adapterType) return DEFAULT_CONTEXT_WINDOW_TOKENS;
  return ADAPTER_CONTEXT_WINDOW_TOKENS[adapterType] ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
}
```

---

## 작업 2: `session-compaction.ts` 수정

`SessionCompactionPolicy` 인터페이스에 `contextWindowTokens` 필드를 추가하고,
`AdapterSessionManagement`에도 동일하게 추가합니다.

```
edit_block packages/adapter-utils/src/session-compaction.ts
```

**변경 내용:**

`SessionCompactionPolicy` 인터페이스에 아래 필드를 추가합니다:
```typescript
  /** 어댑터 컨텍스트 윈도우 크기 (토큰). 0이면 티어 컴팩션 비활성 */
  contextWindowTokens?: number;
```

`ADAPTER_SESSION_MANAGEMENT`의 `claude_local` 항목에:
```typescript
  contextWindowTokens: 200_000,
```

`codex_local` 항목에:
```typescript
  contextWindowTokens: 200_000,
```

`gemini_local` 항목에:
```typescript
  contextWindowTokens: 1_000_000,
```

---

## 작업 3: `packages/adapter-utils/src/index.ts` — export 추가

`index.ts`에 아래 export를 추가합니다:

```typescript
export {
  selectCompactionTier,
  getContextWindowTokens,
  ADAPTER_CONTEXT_WINDOW_TOKENS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
} from "./compaction-tiers.js";
export type { CompactionTier, CompactionDecision, CompactionResult } from "./compaction-tiers.js";
```

---

## 작업 4: `server/src/services/heartbeat.ts` — evaluateSessionCompaction 확장

`heartbeat.ts`에서 `evaluateSessionCompaction` (또는 세션 회전 판단 로직)을 찾아
아래 로직을 추가합니다.

기존 임계값 판단 **이전에** 다음 코드 블록을 삽입합니다:

```typescript
// 멀티티어 컴팩션 판단 (Phase 1)
import { selectCompactionTier, getContextWindowTokens } from "@paperclipai/adapter-utils";

const contextWindowTokens = getContextWindowTokens(adapterType ?? null);
if (contextWindowTokens > 0 && cumulativeInputTokens > 0) {
  const decision = selectCompactionTier(cumulativeInputTokens, contextWindowTokens);
  if (decision.tier !== "none") {
    // micro: 세션 유지하되 코멘트 축약 플래그 설정
    // auto/collapse: 기존 세션 회전 로직으로 위임
    logger.info({ decision, runId }, "멀티티어 컴팩션 결정");
    if (decision.tier === "collapse" || decision.tier === "auto") {
      // 기존 회전 로직을 트리거 — shouldRotate = true 로 설정
    }
  }
}
```

> **참고**: heartbeat.ts의 실제 함수명과 변수명을 먼저 확인한 후,
> 해당 위치에 맞게 삽입하세요. `cumulativeInputTokens`는 런 이벤트나
> 세션 누적 토큰 합산값을 사용합니다.

---

## 작업 5: 테스트 파일 생성

### `packages/adapter-utils/src/compaction-tiers.test.ts`

```typescript
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
```

---

## 완료 확인

```sh
pnpm typecheck
pnpm test --filter @paperclipai/adapter-utils
```

두 명령 모두 오류 없이 통과해야 합니다.
통과하지 못하면 오류 메시지를 분석하여 수정 후 재실행하세요.
