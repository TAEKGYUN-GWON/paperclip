/**
 * briefing-aggregator.ts — 선제적 브리핑 집계 서비스
 *
 * 서버 부팅 시 start()를 호출하면 subscribeGlobalLiveEvents()로
 * 모든 회사의 라이브 이벤트를 구독한다.
 * LLM 추가 호출 없이 기존 데이터(resultJson.summary, activity_log, agent_messages.body)를
 * 재가공하여 ceo_chat_briefings 테이블에 삽입하고
 * "ceo.briefing.created" 이벤트를 발행한다.
 *
 * 디바운스: (companyId, agentId, briefingType) 키로 30초
 * 레이트 리밋: 회사당 분당 10건 (넘으면 드롭)
 */

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  ceoChatBriefings,
  heartbeatRuns,
  issues,
  issueComments,
  agentMessages,
} from "@paperclipai/db";
import type { LiveEvent, BriefingType, BriefingSourceType } from "@paperclipai/shared";
import { subscribeGlobalLiveEvents, publishLiveEvent } from "./live-events.js";
import { summarizeHeartbeatRunResultJson } from "./heartbeat-run-summary.js";
import { featureFlagsService } from "./feature-flags.js";

// ──────────────────────────────────────────────────────────────────────────────
// 레이트 리밋 + 디바운스 상태
// ──────────────────────────────────────────────────────────────────────────────

/** 디바운스 키 → timer handle */
const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();
/** companyId → 분당 발행 수 카운터 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const DEBOUNCE_MS = 30_000;   // 30초
const RATE_LIMIT_PER_MIN = 10; // 분당 10건

function debounceKey(companyId: string, agentId: string | null, briefingType: string) {
  return `${companyId}:${agentId ?? "none"}:${briefingType}`;
}

function isRateLimited(companyId: string): boolean {
  const now = Date.now();
  const state = rateLimitMap.get(companyId);
  if (!state || now >= state.resetAt) {
    rateLimitMap.set(companyId, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  if (state.count >= RATE_LIMIT_PER_MIN) return true;
  state.count += 1;
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// 브리핑 생성 헬퍼
// ──────────────────────────────────────────────────────────────────────────────

async function insertBriefing(
  db: Db,
  input: {
    companyId: string;
    agentId: string | null;
    briefingType: BriefingType;
    title: string;
    body: string;
    sourceType: BriefingSourceType;
    sourceId: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const [row] = await db
    .insert(ceoChatBriefings)
    .values(input)
    .returning();

  if (!row) return;

  publishLiveEvent({
    companyId: input.companyId,
    type: "ceo.briefing.created",
    payload: {
      id: row.id,
      briefingType: row.briefingType,
      title: row.title,
      agentId: row.agentId,
      createdAt: row.createdAt.toISOString(),
    },
  });

  return row;
}

/**
 * 디바운스 래퍼 — 동일 키에서 30초 내 중복 호출 방지.
 * 레이트 리밋 초과 시 드롭.
 */
function scheduleDebounced(
  key: string,
  companyId: string,
  handler: () => Promise<void>,
) {
  const existing = debounceMap.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    debounceMap.delete(key);
    if (isRateLimited(companyId)) return;
    try {
      await handler();
    } catch {
      // 브리핑 실패는 무시 — 핵심 파이프라인에 영향 없어야 함
    }
  }, DEBOUNCE_MS);

  debounceMap.set(key, timer);
}

// ──────────────────────────────────────────────────────────────────────────────
// 헬퍼: 에이전트의 가장 최근 활성 이슈의 projectId 조회
// ──────────────────────────────────────────────────────────────────────────────

async function resolveIssueProjectChannel(
  db: Db,
  companyId: string,
  agentId: string,
): Promise<string | null> {
  const issue = await db
    .select({ projectId: issues.projectId })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, companyId),
        eq(issues.assigneeAgentId, agentId),
      ),
    )
    .orderBy(desc(issues.updatedAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  return issue?.projectId ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// 이벤트 핸들러
// ──────────────────────────────────────────────────────────────────────────────

async function onRunStatusChange(db: Db, event: LiveEvent) {
  const payload = event.payload as {
    runId?: string;
    agentId?: string;
    status?: string;
    error?: string | null;
  };

  const { runId, agentId, status } = payload;
  if (!runId || !agentId) return;
  if (status !== "succeeded" && status !== "failed") return;

  const companyId = event.companyId;

  // ceo_chat 플래그 확인
  const flags = featureFlagsService(db);
  if (!(await flags.isEnabled("ceo_chat"))) return;

  const key = debounceKey(companyId, agentId, status === "succeeded" ? "run_completed" : "run_failed");

  scheduleDebounced(key, companyId, async () => {
    // DB에서 resultJson 조회 (이벤트 페이로드에 미포함)
    const run = await db
      .select({
        id: heartbeatRuns.id,
        agentId: heartbeatRuns.agentId,
        companyId: heartbeatRuns.companyId,
        status: heartbeatRuns.status,
        resultJson: heartbeatRuns.resultJson,
        contextSnapshot: heartbeatRuns.contextSnapshot,
        error: heartbeatRuns.error,
        finishedAt: heartbeatRuns.finishedAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!run) return;

    // 에이전트 이름 조회
    const agent = await db
      .select({ id: agents.id, name: agents.name, role: agents.role })
      .from(agents)
      .where(eq(agents.id, run.agentId))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    const agentName = agent?.name ?? "에이전트";
    const isSuccess = run.status === "succeeded";
    const briefingType = isSuccess ? "run_completed" : "run_failed";

    const summarized = summarizeHeartbeatRunResultJson(run.resultJson);
    const summaryText = (
      (summarized?.["summary"] ?? summarized?.["result"] ?? summarized?.["message"]) as string | undefined
    ) ?? (run.error ?? null);

    const title = isSuccess
      ? `${agentName} 작업 완료`
      : `${agentName} 작업 실패`;

    const body = summaryText
      ? summaryText.slice(0, 500)
      : isSuccess
        ? "에이전트가 작업을 성공적으로 완료했습니다."
        : "에이전트 실행 중 오류가 발생했습니다.";

    // 단체 톡방 연계: contextSnapshot에 groupChatChannelId가 있거나
    // run에 연결된 이슈의 projectId를 조회하여 해당 채널에 자동 포스팅
    const snapshot = run.contextSnapshot ?? {};
    const groupChatChannelId = (snapshot["groupChatChannelId"] as string | undefined) ?? null;

    await insertBriefing(db, {
      companyId,
      agentId: run.agentId,
      briefingType,
      title,
      body,
      sourceType: "heartbeat_run",
      sourceId: run.id,
      metadata: groupChatChannelId ? { runId: run.id, groupChatChannelId } : { runId: run.id },
    });

    // 이슈의 projectId 조회 → 해당 프로젝트 채널에 자동 포스팅
    const targetChannelId = groupChatChannelId ?? await resolveIssueProjectChannel(db, companyId, run.agentId);
    if (targetChannelId) {
      await db.insert(agentMessages).values({
        companyId,
        channelId: targetChannelId,
        fromAgentId: run.agentId,
        toAgentId: null,
        mode: "broadcast",
        priority: 1,
        type: "status_update",
        subject: title,
        body,
        metadata: { sourceType: "heartbeat_run", sourceId: run.id },
        status: "delivered",
      });
      publishLiveEvent({
        companyId,
        type: "group.message.created",
        payload: { channelId: targetChannelId, fromAgentId: run.agentId, subject: title },
      });
    }
  });
}

async function onActivityLogged(db: Db, event: LiveEvent) {
  const payload = event.payload as {
    action?: string;
    entityType?: string;
    entityId?: string;
    agentId?: string;
    details?: Record<string, unknown>;
  };

  const { action, entityType, entityId, agentId } = payload;
  if (!action || !entityId) return;

  const companyId = event.companyId;
  const flags = featureFlagsService(db);
  if (!(await flags.isEnabled("ceo_chat"))) return;

  // 이슈 생성/배정 이벤트만 브리핑으로 변환
  if (action !== "issue.created" && action !== "issue.assigned") return;
  if (entityType !== "issue") return;

  const briefingType = action === "issue.created" ? "issue_created" : "issue_assigned";
  const key = debounceKey(companyId, agentId ?? null, briefingType);

  scheduleDebounced(key, companyId, async () => {
    // 이슈 제목 조회
    const issue = await db
      .select({ id: issues.id, title: issues.title, assigneeAgentId: issues.assigneeAgentId })
      .from(issues)
      .where(eq(issues.id, entityId))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!issue) return;

    const issueTitle = issue.title ?? "이슈";
    const assigneeId = issue.assigneeAgentId;

    let assigneeName: string | null = null;
    if (assigneeId) {
      const assigneeAgent = await db
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, assigneeId))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      assigneeName = assigneeAgent?.name ?? null;
    }

    const title =
      briefingType === "issue_created"
        ? `새 이슈: ${issueTitle}`
        : `이슈 배정: ${issueTitle}`;

    const body =
      briefingType === "issue_created"
        ? `이슈 "${issueTitle}"가 생성되었습니다.`
        : assigneeName
          ? `"${issueTitle}" 이슈가 ${assigneeName}에게 배정되었습니다.`
          : `"${issueTitle}" 이슈가 배정되었습니다.`;

    await insertBriefing(db, {
      companyId,
      agentId: assigneeId ?? null,
      briefingType,
      title,
      body,
      sourceType: "activity_log",
      sourceId: entityId,
      metadata: { issueId: entityId },
    });
  });
}

async function onAgentMessage(db: Db, event: LiveEvent) {
  const payload = event.payload as {
    messageId?: string;
    fromAgentId?: string;
    toAgentId?: string;
    type?: string;
    subject?: string | null;
    body?: string;
  };

  const { messageId, fromAgentId, body: msgBody } = payload;
  if (!messageId || !fromAgentId || !msgBody) return;

  const companyId = event.companyId;
  const flags = featureFlagsService(db);
  if (!(await flags.isEnabled("ceo_chat"))) return;

  // status_update / notification 타입만 브리핑으로 변환
  const msgType = payload.type ?? "";
  if (!["status_update", "notification"].includes(msgType)) return;

  const key = debounceKey(companyId, fromAgentId, "agent_report");

  scheduleDebounced(key, companyId, async () => {
    const agent = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, fromAgentId))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    const agentName = agent?.name ?? "에이전트";
    const title = `${agentName} 보고`;
    const body = (payload.subject ? `[${payload.subject}] ` : "") + msgBody.slice(0, 400);

    await insertBriefing(db, {
      companyId,
      agentId: fromAgentId,
      briefingType: "agent_report",
      title,
      body,
      sourceType: "agent_message",
      sourceId: messageId,
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 서비스 팩토리
// ──────────────────────────────────────────────────────────────────────────────

export function briefingAggregatorService(db: Db) {
  let unsubscribe: (() => void) | null = null;

  function start() {
    if (unsubscribe) return; // 이미 구독 중

    unsubscribe = subscribeGlobalLiveEvents(async (event: LiveEvent) => {
      // 회사 컨텍스트 없는 글로벌 이벤트는 무시
      if (event.companyId === "*") return;

      try {
        if (event.type === "heartbeat.run.status") {
          await onRunStatusChange(db, event);
        } else if (event.type === "activity.logged") {
          await onActivityLogged(db, event);
        } else if (event.type === "agent.message.received") {
          await onAgentMessage(db, event);
        }
      } catch {
        // 집계 실패는 핵심 파이프라인에 영향 없도록 무시
      }
    });
  }

  function stop() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    // 미처리 디바운스 타이머 정리
    for (const timer of debounceMap.values()) clearTimeout(timer);
    debounceMap.clear();
    rateLimitMap.clear();
  }

  return { start, stop };
}
