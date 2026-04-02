/**
 * group-chat.ts — 프로젝트 단위 단체 톡방 서비스
 *
 * 채널 ID = projectId (UUID).
 * 에이전트 자동 포스팅 (LLM 0회), @에이전트 멘션 → wakeup (LLM 1회),
 * #이슈 멘션 → 링크 메타데이터 저장 (LLM 0회).
 */

import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentMessages, agents, projects } from "@paperclipai/db";
import { publishLiveEvent } from "./live-events.js";
import { parseMentions } from "./mention-parser.js";

export type ChannelMessage = typeof agentMessages.$inferSelect;

export interface PostAgentUpdateInput {
  companyId: string;
  channelId: string;         // = projectId
  agentId: string;
  title: string;
  body: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface SendUserMessageInput {
  companyId: string;
  channelId: string;         // = projectId
  userId: string;
  body: string;
}

export interface GetHistoryOptions {
  before?: string;           // ISO timestamp (exclusive upper bound)
  limit?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// 서비스 팩토리
// ──────────────────────────────────────────────────────────────────────────────

export function groupChatService(db: Db) {
  /**
   * 회사의 모든 프로젝트 채널 목록 반환.
   * 채널 ID = projectId.
   */
  async function listChannels(
    companyId: string,
  ): Promise<{ projectId: string; name: string; createdAt: string }[]> {
    const rows = await db
      .select({ id: projects.id, name: projects.name, createdAt: projects.createdAt })
      .from(projects)
      .where(eq(projects.companyId, companyId))
      .orderBy(asc(projects.name));

    return rows.map((r) => ({
      projectId: r.id,
      name: r.name,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * 채널 히스토리 조회 (최신→구 정렬).
   */
  async function getHistory(
    companyId: string,
    channelId: string,
    opts?: GetHistoryOptions,
  ): Promise<ChannelMessage[]> {
    const limit = Math.min(opts?.limit ?? 50, 200);

    const rows = await db
      .select()
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.companyId, companyId),
          eq(agentMessages.channelId as Parameters<typeof eq>[0], channelId),
        ),
      )
      .orderBy(desc(agentMessages.createdAt))
      .limit(limit);

    return rows;
  }

  /**
   * 에이전트가 채널에 자동 포스팅 (LLM 0회).
   * BriefingAggregator 또는 heartbeat 완료 콜백에서 호출.
   */
  async function postAgentUpdate(input: PostAgentUpdateInput): Promise<ChannelMessage> {
    const [msg] = await db
      .insert(agentMessages)
      .values({
        companyId: input.companyId,
        channelId: input.channelId,
        fromAgentId: input.agentId,
        toAgentId: null,
        mode: "broadcast",
        priority: 1,
        type: "status_update",
        subject: input.title,
        body: input.body,
        metadata: {
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
          ...(input.metadata ?? {}),
        },
        status: "delivered",
      })
      .returning();

    publishLiveEvent({
      companyId: input.companyId,
      type: "group.message.created",
      payload: {
        messageId: msg!.id,
        channelId: input.channelId,
        fromAgentId: input.agentId,
        fromUserId: null,
        subject: input.title,
        body: input.body.slice(0, 200),
      },
    });

    return msg!;
  }

  /**
   * 사용자가 채널에 메시지 전송.
   * @에이전트 / #이슈 멘션 파싱 → metadata에 저장.
   * 실제 wakeup은 라우트 레이어에서 처리 (heartbeat 순환 의존 방지).
   */
  async function sendUserMessage(
    input: SendUserMessageInput,
  ): Promise<{
    message: ChannelMessage;
    agentMentionIds: string[];
    issueMentionIds: string[];
  }> {
    const { agentMentions, issueMentions } = await parseMentions(
      db,
      input.companyId,
      input.body,
    );

    const agentMentionIds = agentMentions.map((m) => m.agentId);
    const issueMentionIds = issueMentions.map((m) => m.issueId);

    const [msg] = await db
      .insert(agentMessages)
      .values({
        companyId: input.companyId,
        channelId: input.channelId,
        fromAgentId: null,
        fromUserId: input.userId,
        toAgentId: null,
        mode: "broadcast",
        priority: 1,
        type: "notification",
        body: input.body,
        metadata: {
          agentMentions: agentMentions.map((m) => ({ agentId: m.agentId, name: m.name })),
          issueMentions: issueMentions.map((m) => ({ issueId: m.issueId, ref: m.ref })),
        },
        status: "delivered",
      })
      .returning();

    publishLiveEvent({
      companyId: input.companyId,
      type: "group.message.created",
      payload: {
        messageId: msg!.id,
        channelId: input.channelId,
        fromAgentId: null,
        fromUserId: input.userId,
        body: input.body.slice(0, 200),
        agentMentionIds,
        issueMentionIds,
      },
    });

    return {
      message: msg!,
      agentMentionIds,
      issueMentionIds,
    };
  }

  return {
    listChannels,
    getHistory,
    postAgentUpdate,
    sendUserMessage,
  };
}
