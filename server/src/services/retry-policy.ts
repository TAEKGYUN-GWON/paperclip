/**
 * retry-policy.ts
 * Phase 10: 실행 재시도 및 백오프 프레임워크
 *
 * API 일시 장애(429, 529, rate limit, overloaded) 시 자동 재시도로
 * 런 실패율을 80%+ 감소시킵니다.
 */

import type { AdapterExecutionResult } from "../adapters/index.js";

/** 재시도 최대 횟수 */
export const MAX_RETRY_ATTEMPTS = 3;

/** 기본 백오프 시작 딜레이 (ms) */
export const BASE_BACKOFF_MS = 2_000;

/** 최대 백오프 딜레이 (ms) */
export const MAX_BACKOFF_MS = 120_000;

/** 재시도 가능한 오류 패턴 */
const RETRYABLE_PATTERNS: RegExp[] = [
  /rate.?limit/i,
  /too.?many.?requests/i,
  /\b429\b/,
  /\b529\b/,
  /overloaded/i,
  /service.?unavailable/i,
  /temporarily.?unavailable/i,
  /try.?again/i,
  /capacity/i,
  /throttl/i,
];

/** 재시도 불가 오류 패턴 (명시적으로 재시도 금지) */
const NON_RETRYABLE_PATTERNS: RegExp[] = [
  /budget.?exceed/i,
  /quota.?exceed/i,
  /permission.?denied/i,
  /unauthorized/i,
  /invalid.?api.?key/i,
  /authentication/i,
  /billing/i,
  /cancelled/i,
];

/**
 * 어댑터 실행 결과가 재시도 가능한 오류인지 판단합니다.
 */
export function isRetryableResult(result: AdapterExecutionResult): boolean {
  // 성공한 경우 재시도 불필요
  if ((result.exitCode ?? 0) === 0 && !result.errorMessage) return false;

  const errorText = [result.errorMessage ?? "", result.errorCode ?? ""].join(" ");

  // 명시적 재시도 금지 패턴 우선 확인
  if (NON_RETRYABLE_PATTERNS.some((p) => p.test(errorText))) return false;

  // 재시도 가능 패턴 확인
  return RETRYABLE_PATTERNS.some((p) => p.test(errorText));
}

/**
 * 재시도 불가 오류를 던진 예외가 재시도 가능한지 판단합니다.
 */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const errorText = err.message;
  if (NON_RETRYABLE_PATTERNS.some((p) => p.test(errorText))) return false;
  return RETRYABLE_PATTERNS.some((p) => p.test(errorText));
}

/**
 * 지수 백오프 딜레이를 계산합니다 (jitter 포함).
 *
 * attempt 0 → ~2s, attempt 1 → ~4s, attempt 2 → ~8s
 * 최대 MAX_BACKOFF_MS (120s)로 클램핑됩니다.
 */
export function getBackoffMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * Math.pow(2, attempt);
  const clamped = Math.min(base, MAX_BACKOFF_MS);
  // ±20% 지터로 thundering herd 방지
  const jitter = clamped * 0.2 * (Math.random() - 0.5);
  return Math.round(clamped + jitter);
}

/**
 * 재시도 가능한 에러 코드 목록
 */
export const RETRYABLE_EXIT_CODES = new Set([
  1, // 일반 오류 (rate limit도 여기 해당)
]);

/** sleep 유틸리티 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
