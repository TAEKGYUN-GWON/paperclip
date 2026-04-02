/**
 * ceo-chat.ts — CEO Chat Service
 *
 * CEO 1:1 채팅의 핵심 서비스.
 * - 회사당 하나의 "대화형 이슈" (originKind: "conversation")를 조회/생성
 * - 사용자 메시지를 이슈 코멘트로 추가 → 기존 wakeup 파이프라인으로 CEO 에이전트 호출
 * - 코멘트 + 실행 결과 + 브리핑을 통합한 타임라인 반환
 */

import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  ceoChatBriefings,
  heartbeatRuns,
  issueComments,
  issues,
} from "@paperclipai/db";
import { featureFlagsService } from "./feature-flags.js";

// ──────────────────────────────────────────────────────────────────────────────
// 타임라인 아이템 타입
// ──────────────────────────────────────────────────────────────────────────────

export type TimelineItemKind = "comment" | "run" | "briefing";

export interface CommentTimelineItem {
  kind: "comment";
  id: string;
  issueId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: string;
}

export interface RunTimelineItem {
  kind: "run";
  id: string;
  agentId: string;
  status: string;
  summary: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface BriefingTimelineItem {
  kind: "briefing";
  id: string;
  agentId: string | null;
  briefingType: string;
  title: string;
  body: string;
  sourceType: string;
  sourceId: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export type TimelineItem = CommentTimelineItem | RunTimelineItem | BriefingTimelineItem;

// ──────────────────────────────────────────────────────────────────────────────
// 서비스 팩토리
// ──────────────────────────────────────────────────────────────────────────────

export function ceoChatService(db: Db) {
  const flags = featureFlagsService(db);

  /** 피처 플래그 확인 */
  async function isEnabled(companyId: string): Promise<boolean> {
    void companyId;
    return flags.isEnabled("ceo_chat");
  }

  /**
   * 회사의 CEO 에이전트 ID 조회.
   * 복수인 경우 가장 최근 생성된 active CEO를 반환.
   * 없으면 null.
   */
  async function getCeoAgentId(companyId: string): Promise<string | null> {
    const ceo = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          eq(agents.role, "ceo"),
          ne(agents.status, "terminated"),
        ),
      )
      .orderBy(desc(agents.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    return ceo?.id ?? null;
  }

  /**
   * 회사의 대화형 이슈(CEO 채팅 세션)를 조회하거나 생성한다.
   * originKind: "conversation" 이슈는 회사당 1개를 유지한다.
   */
  async function getOrCreateConversation(companyId: string): Promise<typeof issues.$inferSelect> {
    // 기존 대화 이슈 조회
    const existing = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.originKind, "conversation"),
          isNull(issues.cancelledAt),
        ),
      )
      .orderBy(desc(issues.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (existing) return existing;

    // CEO 에이전트 조회
    const ceoId = await getCeoAgentId(companyId);

    // 신규 대화 이슈 생성
    const [newIssue] = await db
      .insert(issues)
      .values({
        companyId,
        title: "CEO 채팅",
        status: "in_progress",
        priority: "medium",
        originKind: "conversation",
        assigneeAgentId: ceoId ?? null,
      })
      .returning();

    return newIssue!;
  }

  /**
   * 사용자 메시지를 CEO 채팅에 전송한다.
   * 내부적으로 대화 이슈에 코멘트를 추가하여 기존 wakeup 파이프라인을 활용한다.
   * wakeup 자체는 라우트 레이어에서 처리한다 (heartbeat 순환 의존 방지).
   */
  async function sendMessage(
    companyId: string,
    userId: string,
    body: string,
  ): Promise<{ comment: typeof issueComments.$inferSelect; issueId: string; ceoAgentId: string | null }> {
    const conversation = await getOrCreateConversation(companyId);

    const [comment] = await db
      .insert(issueComments)
      .values({
        companyId,
        issueId: conversation.id,
        authorUserId: userId,
        body,
      })
      .returning();

    // updatedAt 갱신으로 이슈 목록 정렬 반영
    await db
      .update(issues)
      .set({ updatedAt: new Date() })
      .where(eq(issues.id, conversation.id));

    return {
      comment: comment!,
      issueId: conversation.id,
      ceoAgentId: conversation.assigneeAgentId,
    };
  }

  /**
   * CEO 채팅 통합 타임라인 조회.
   * 코멘트 + 완료된 heartbeat run + 브리핑을 최신순으로 병합한다.
   */
  async function getTimeline(
    companyId: string,
    opts?: { limit?: number },
  ): Promise<TimelineItem[]> {
    const limit = opts?.limit ?? 50;

    const conversation = await getOrCreateConversation(companyId);
    const issueId = conversation.id;

    // 1. 이슈 코멘트
    const comments = await db
      .select()
      .from(issueComments)
      .where(eq(issueComments.issueId, issueId))
      .orderBy(desc(issueComments.createdAt))
      .limit(limit);

    // 2. 연결된 heartbeat run (요약 있는 것만)
    const runs = await db
      .select({
        id: heartbeatRuns.id,
        agentId: heartbeatRuns.agentId,
        status: heartbeatRuns.status,
        resultJson: heartbeatRuns.resultJson,
        createdAt: heartbeatRuns.createdAt,
        finishedAt: heartbeatRuns.finishedAt,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          // CEO 에이전트 runs만
          conversation.assigneeAgentId
            ? eq(heartbeatRuns.agentId, conversation.assigneeAgentId)
            : undefined,
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(limit);

    // 3. 브리핑 레코드
    const briefings = await db
      .select()
      .from(ceoChatBriefings)
      .where(eq(ceoChatBriefings.companyId, companyId))
      .orderBy(desc(ceoChatBriefings.createdAt))
      .limit(limit);

    // 통합 타임라인 생성
    const items: TimelineItem[] = [
      ...comments.map(
        (c): CommentTimelineItem => ({
          kind: "comment",
          id: c.id,
          issueId: c.issueId,
          authorAgentId: c.authorAgentId,
          authorUserId: c.authorUserId,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        }),
      ),
      ...runs.map(
        (r): RunTimelineItem => ({
          kind: "run",
          id: r.id,
          agentId: r.agentId,
          status: r.status,
          summary: extractRunSummary(r.resultJson),
          createdAt: r.createdAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
        }),
      ),
      ...briefings.map(
        (b): BriefingTimelineItem => ({
          kind: "briefing",
          id: b.id,
          agentId: b.agentId,
          briefingType: b.briefingType,
          title: b.title,
          body: b.body,
          sourceType: b.sourceType,
          sourceId: b.sourceId,
          metadata: b.metadata as Record<string, unknown> | null,
          readAt: b.readAt?.toISOString() ?? null,
          createdAt: b.createdAt.toISOString(),
        }),
      ),
    ];

    // 시간순 정렬 (최신 → 구)
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items.slice(0, limit);
  }

  /**
   * 브리핑 미읽음 수 조회
   */
  async function getUnreadBriefingCount(companyId: string): Promise<number> {
    const rows = await db
      .select({ id: ceoChatBriefings.id })
      .from(ceoChatBriefings)
      .where(
        and(
          eq(ceoChatBriefings.companyId, companyId),
          isNull(ceoChatBriefings.readAt),
        ),
      );
    return rows.length;
  }

  /**
   * 모든 브리핑을 읽음 처리
   */
  async function markAllBriefingsRead(companyId: string): Promise<void> {
    await db
      .update(ceoChatBriefings)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(ceoChatBriefings.companyId, companyId),
          isNull(ceoChatBriefings.readAt),
        ),
      );
  }

  return {
    isEnabled,
    getCeoAgentId,
    getOrCreateConversation,
    sendMessage,
    getTimeline,
    getUnreadBriefingCount,
    markAllBriefingsRead,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────────────────────────

function extractRunSummary(resultJson: Record<string, unknown> | null | undefined): string | null {
  if (!resultJson || typeof resultJson !== "object") return null;
  const summary = resultJson["summary"] ?? resultJson["result"] ?? resultJson["message"];
  if (typeof summary === "string") return summary.slice(0, 500);
  return null;
}
