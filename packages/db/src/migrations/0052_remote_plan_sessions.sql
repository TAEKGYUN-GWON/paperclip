-- Phase 20: ULTRAPLAN Remote Plan Offload
-- Creates the remote_plan_sessions table for tracking planning sessions.

CREATE TABLE "remote_plan_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "requested_by_agent_id" uuid,
  "requested_by_user_id" text,
  "source_issue_id" uuid,
  "planner_agent_id" uuid NOT NULL,
  "status" text DEFAULT 'planning' NOT NULL,
  "phase" text DEFAULT 'running' NOT NULL,
  "plan_text" text,
  "plan_workflow" jsonb,
  "edited_plan" text,
  "user_feedback" text,
  "pending_question" text,
  "execution_target" text,
  "coordinator_session_id" uuid,
  "routine_run_id" text,
  "poll_interval_ms" integer DEFAULT 3000 NOT NULL,
  "timeout_ms" integer DEFAULT 1800000 NOT NULL,
  "max_consecutive_failures" integer DEFAULT 5 NOT NULL,
  "reject_count" integer DEFAULT 0 NOT NULL,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "last_polled_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "remote_plan_sessions" ADD CONSTRAINT "remote_plan_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "remote_plan_sessions" ADD CONSTRAINT "remote_plan_sessions_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "remote_plan_sessions" ADD CONSTRAINT "remote_plan_sessions_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "remote_plan_sessions" ADD CONSTRAINT "remote_plan_sessions_planner_agent_id_agents_id_fk" FOREIGN KEY ("planner_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "remote_plan_sessions" ADD CONSTRAINT "remote_plan_sessions_coordinator_session_id_coordinator_sessions_id_fk" FOREIGN KEY ("coordinator_session_id") REFERENCES "public"."coordinator_sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "remote_plan_sessions_company_status_idx" ON "remote_plan_sessions" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX "remote_plan_sessions_company_requested_by_agent_idx" ON "remote_plan_sessions" USING btree ("company_id","requested_by_agent_id");
--> statement-breakpoint
CREATE INDEX "remote_plan_sessions_planner_agent_status_idx" ON "remote_plan_sessions" USING btree ("planner_agent_id","status");
--> statement-breakpoint
CREATE INDEX "remote_plan_sessions_expires_at_idx" ON "remote_plan_sessions" USING btree ("expires_at");
