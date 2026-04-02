import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import type { BriefingType, BriefingSourceType } from "@paperclipai/shared";

/**
 * ceo_chat_briefings — CEO Chat: 선제적 브리핑
 *
 * CEO가 먼저 현황을 보고하는 레코드.
 * LLM 호출 없이 기존 이벤트(heartbeat run 완료, activity, agent message)를
 * BriefingAggregator 서비스가 재가공하여 삽입한다.
 */
export const ceoChatBriefings = pgTable(
  "ceo_chat_briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    // 관련 에이전트 (run을 실행한 에이전트, 보고한 에이전트 등)
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    // "run_completed" | "run_failed" | "issue_created" | "issue_assigned" | "agent_report" | "delegation" | "error"
    briefingType: text("briefing_type").$type<BriefingType>().notNull(),
    // CEO 채팅 타임라인에 표시될 한 줄 제목
    title: text("title").notNull(),
    // resultJson.summary 등에서 추출한 마크다운 본문
    body: text("body").notNull(),
    // "heartbeat_run" | "activity_log" | "agent_message"
    sourceType: text("source_type").$type<BriefingSourceType>().notNull(),
    // 원본 레코드 ID (runId, activityId, messageId 등)
    sourceId: text("source_id"),
    // 추가 컨텍스트 (issueId, runId, projectId 등)
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    // 사용자가 읽은 시각 (null = 미읽음)
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // CEO 채팅 타임라인 조회: 회사별 최신순
    companyCreatedAtIdx: index("ceo_chat_briefings_company_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
    // 미읽음 배지 카운트용
    companyUnreadIdx: index("ceo_chat_briefings_company_unread_idx").on(
      table.companyId,
      table.readAt,
    ),
  }),
);
