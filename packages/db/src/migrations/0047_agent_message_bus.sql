-- Phase 18: Agent Message Bus
-- Creates agent_messages and agent_shared_memory tables.

CREATE TABLE "agent_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "from_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "to_agent_id" uuid REFERENCES "agents"("id"),
  "mode" text NOT NULL DEFAULT 'direct',
  "priority" integer NOT NULL DEFAULT 1,
  "type" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "reply_to_id" uuid REFERENCES "agent_messages"("id"),
  "status" text NOT NULL DEFAULT 'queued',
  "expires_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "agent_messages_to_agent_status_idx"
  ON "agent_messages" ("to_agent_id", "status", "created_at");--> statement-breakpoint

CREATE INDEX "agent_messages_from_agent_idx"
  ON "agent_messages" ("from_agent_id", "created_at");--> statement-breakpoint

CREATE INDEX "agent_messages_company_mode_status_idx"
  ON "agent_messages" ("company_id", "mode", "status");--> statement-breakpoint

CREATE INDEX "agent_messages_expires_at_idx"
  ON "agent_messages" ("expires_at");--> statement-breakpoint

CREATE TABLE "agent_shared_memory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "namespace" text NOT NULL DEFAULT 'default',
  "key" text NOT NULL,
  "value" jsonb,
  "author_agent_id" uuid REFERENCES "agents"("id"),
  "ttl_seconds" integer,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "agent_shared_memory_company_ns_key_uq"
  ON "agent_shared_memory" ("company_id", "namespace", "key");--> statement-breakpoint

CREATE INDEX "agent_shared_memory_expires_at_idx"
  ON "agent_shared_memory" ("expires_at");--> statement-breakpoint

CREATE INDEX "agent_shared_memory_company_ns_idx"
  ON "agent_shared_memory" ("company_id", "namespace");
