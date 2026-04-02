-- Phase 21: Permission Delegation Protocol
-- Worker → Coordinator → User permission escalation requests.
-- Ported from Claude Code swarm/permissionSync.ts, adapted to DB + message bus.

CREATE TABLE "permission_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "coordinator_session_id" uuid NOT NULL REFERENCES "coordinator_sessions"("id") ON DELETE CASCADE,
  "worker_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "resolver_agent_id" uuid REFERENCES "agents"("id"),
  "resolver_user_id" text,
  "tool_name" text NOT NULL,
  "permission_type" text NOT NULL,
  "description" text NOT NULL,
  "tool_input" jsonb NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'pending',
  "grant_scope" text,
  "feedback" text,
  "updated_input" jsonb,
  "expires_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "permission_requests_company_session_status_idx"
  ON "permission_requests" ("company_id", "coordinator_session_id", "status");--> statement-breakpoint

CREATE INDEX "permission_requests_company_worker_status_idx"
  ON "permission_requests" ("company_id", "worker_agent_id", "status");--> statement-breakpoint

CREATE INDEX "permission_requests_expires_at_idx"
  ON "permission_requests" ("expires_at");
