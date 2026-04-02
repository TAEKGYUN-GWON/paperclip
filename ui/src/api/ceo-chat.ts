import { api } from "./client";

// ──────────────────────────────────────────────────────────────────────────────
// 타임라인 아이템 타입 (server/src/services/ceo-chat.ts와 동기화 유지)
// ──────────────────────────────────────────────────────────────────────────────

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

export interface CeoConversation {
  id: string;
  companyId: string;
  title: string;
  status: string;
  assigneeAgentId: string | null;
  originKind: string;
  createdAt: string;
  updatedAt: string;
}

export interface SendMessageResult {
  comment: {
    id: string;
    issueId: string;
    body: string;
    authorUserId: string | null;
    createdAt: string;
  };
  issueId: string;
  ceoAgentId: string | null;
  run: { id: string; status: string } | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// API 클라이언트
// ──────────────────────────────────────────────────────────────────────────────

export const ceoChatApi = {
  getConversation: (companyId: string) =>
    api.get<{ conversation: CeoConversation; ceoAgentId: string | null }>(
      `/companies/${companyId}/ceo-chat`,
    ),

  sendMessage: (companyId: string, body: string) =>
    api.post<SendMessageResult>(
      `/companies/${companyId}/ceo-chat/messages`,
      { body },
    ),

  getTimeline: (companyId: string, limit = 50) =>
    api.get<{ timeline: TimelineItem[] }>(
      `/companies/${companyId}/ceo-chat/timeline?limit=${encodeURIComponent(String(limit))}`,
    ),

  getUnreadCount: (companyId: string) =>
    api.get<{ count: number }>(
      `/companies/${companyId}/ceo-chat/briefings/unread-count`,
    ),

  markAllRead: (companyId: string) =>
    api.post<{ ok: boolean }>(
      `/companies/${companyId}/ceo-chat/briefings/mark-read`,
      {},
    ),
};
