-- Phase CEO Chat: CEO 1:1 채팅, 선제적 브리핑, 단체 톡방
-- agent_messages 확장 + ceo_chat_briefings 신규

-- 1. agent_messages: fromAgentId nullable 변경 (사용자 발신 허용)
ALTER TABLE "agent_messages"
  ALTER COLUMN "from_agent_id" DROP NOT NULL;--> statement-breakpoint

-- 2. agent_messages: fromUserId 추가 (사용자 발신 식별)
ALTER TABLE "agent_messages"
  ADD COLUMN IF NOT EXISTS "from_user_id" text;--> statement-breakpoint

-- 3. agent_messages: channelId 추가 (단체 톡방 채널 = projectId)
ALTER TABLE "agent_messages"
  ADD COLUMN IF NOT EXISTS "channel_id" uuid;--> statement-breakpoint

-- 4. agent_messages: 채널 히스토리 조회용 인덱스
CREATE INDEX IF NOT EXISTS "agent_messages_channel_idx"
  ON "agent_messages" ("company_id", "channel_id", "created_at");--> statement-breakpoint

-- 5. ceo_chat_briefings: CEO 선제적 브리핑 레코드 (LLM 0회, 기존 데이터 재가공)
CREATE TABLE IF NOT EXISTS "ceo_chat_briefings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "briefing_type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text,
  "metadata" jsonb,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ceo_chat_briefings_company_created_at_idx"
  ON "ceo_chat_briefings" ("company_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ceo_chat_briefings_company_unread_idx"
  ON "ceo_chat_briefings" ("company_id", "read_at")
  WHERE "read_at" IS NULL;
