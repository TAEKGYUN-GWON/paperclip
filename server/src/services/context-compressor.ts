/**
 * context-compressor.ts
 * Phase 9: 3계층 컨텍스트 압축
 *
 * 세션 회전(핵옵션) 전에 두 단계의 경량 압축을 먼저 시도합니다.
 *
 *   Layer 1 (snip)    — micro 티어(70-85%): 최근 런 요약 스냅샷, 세션 유지
 *   Layer 2 (compact) — auto 티어(85-95%): 구조화된 다이제스트, 세션 유지
 *   Layer 3 (rotate)  — collapse 티어(95%+): 기존 세션 회전 (최후 수단)
 */

import { truncateToTokenBudget } from "@paperclipai/adapter-utils";
import type { CompactionDecision } from "@paperclipai/adapter-utils";

/** evaluateSessionCompaction에서 전달되는 런 레코드 (DB 쿼리 결과 서브셋) */
export interface RunRecord {
  id: string;
  createdAt: Date | string;
  resultJson: Record<string, unknown> | null | undefined;
  error: string | null | undefined;
}

/** Layer 1/2 최대 토큰 예산 */
const SNIP_SUMMARY_MAX_TOKENS = 150;
const COMPACT_SUMMARY_MAX_TOKENS = 250;

/**
 * 런 레코드에서 텍스트 요약을 추출합니다.
 * resultJson의 summary/result/message → error 순으로 탐색합니다.
 */
function extractRunSummary(run: RunRecord): string | null {
  const rj = run.resultJson;
  if (rj && typeof rj === "object" && !Array.isArray(rj)) {
    const text =
      (typeof rj.summary === "string" ? rj.summary : null) ??
      (typeof rj.result === "string" ? rj.result : null) ??
      (typeof rj.message === "string" ? rj.message : null);
    if (text) return truncateToTokenBudget(text, SNIP_SUMMARY_MAX_TOKENS, "tail");
  }
  if (run.error) return `error: ${truncateToTokenBudget(run.error, 80, "tail")}`;
  return null;
}

/**
 * Date 또는 ISO 문자열을 "YYYY-MM-DD HH:mm" 형식으로 포맷합니다.
 */
function formatRunDate(createdAt: Date | string): string {
  try {
    const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
    return d.toISOString().replace("T", " ").slice(0, 16);
  } catch {
    const s = String(createdAt);
    return s.length >= 16 ? s.slice(0, 16) : s;
  }
}

/**
 * Layer 1 (snip): micro 티어에서 최근 3개 런을 1줄씩 요약하여 주입합니다.
 *
 * 세션을 유지하면서 에이전트가 최근 작업 맥락을 빠르게 파악할 수 있도록 합니다.
 * 반환 값이 빈 문자열이면 주입하지 않습니다.
 */
export function buildSnipContext(
  runs: RunRecord[],
  tierDecision: CompactionDecision,
): string {
  const recentRuns = runs.slice(0, 3);
  const lines: string[] = [];
  for (let i = 0; i < recentRuns.length; i++) {
    const run = recentRuns[i];
    const summary = extractRunSummary(run);
    if (!summary) continue;
    const date = formatRunDate(run.createdAt);
    lines.push(`${i + 1}. [${date}] ${summary}`);
  }
  if (lines.length === 0) return "";

  return [
    `## Session Context Snapshot (context ${tierDecision.utilizationPercent}% used)`,
    "Recent work summary (session continuing):",
    ...lines,
    "→ Continue with the current task.",
  ].join("\n");
}

/**
 * Layer 2 (compact): auto 티어에서 최근 8개 런을 구조화된 마크다운으로 요약합니다.
 *
 * 세션 회전 없이 에이전트가 전체 작업 이력을 파악할 수 있게 합니다.
 * collapse 티어로 넘어가면 이 다이제스트를 핸드오프 요약의 기반으로 사용합니다.
 */
export function buildCompactDigest(
  runs: RunRecord[],
  sessionId: string,
  issueId: string | null,
  tierDecision: CompactionDecision,
): string {
  const recentRuns = runs.slice(0, 8);
  const lines: string[] = [
    "## Session Compact Digest",
    `Session: ${sessionId}${issueId ? ` | Issue: ${issueId}` : ""}`,
    `Context utilization: ${tierDecision.utilizationPercent}% (session continuing — rotation deferred)`,
    "",
    "### Work history (most recent first):",
  ];

  let hasAny = false;
  for (let i = 0; i < recentRuns.length; i++) {
    const run = recentRuns[i];
    const date = formatRunDate(run.createdAt);
    const rj = run.resultJson;
    let summary: string | null = null;
    if (rj && typeof rj === "object" && !Array.isArray(rj)) {
      const raw =
        (typeof rj.summary === "string" ? rj.summary : null) ??
        (typeof rj.result === "string" ? rj.result : null) ??
        (typeof rj.message === "string" ? rj.message : null);
      if (raw) summary = truncateToTokenBudget(raw, COMPACT_SUMMARY_MAX_TOKENS, "tail");
    }
    if (!summary && run.error) {
      summary = `error: ${truncateToTokenBudget(run.error, 100, "tail")}`;
    }
    if (!summary) continue;
    lines.push(`${i + 1}. [${date}] ${summary}`);
    hasAny = true;
  }

  if (!hasAny) {
    lines.push("(no recent run summaries)");
  }

  lines.push("");
  lines.push("→ Use the history above to continue the current task. Session is maintained.");
  return lines.join("\n");
}
