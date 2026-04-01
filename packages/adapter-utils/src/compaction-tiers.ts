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
