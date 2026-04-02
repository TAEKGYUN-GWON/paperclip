-- Phase 12 + 19: Task Graph (issue_dependencies) + Coordinator Mode
-- These tables were implemented in Wave 2-3 but lacked SQL migrations.
-- Must run before 0048_permission_delegation (which FKs coordinator_sessions).

-- ---------------------------------------------------------------------------
-- Phase 12: issue_dependencies (Task Graph)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "issue_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "depends_on_issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "kind" text NOT NULL DEFAULT 'blocks',
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "issue_dependencies_unique_edge_idx"
  ON "issue_dependencies" ("issue_id", "depends_on_issue_id", "kind");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "issue_dependencies_issue_idx"
  ON "issue_dependencies" ("issue_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "issue_dependencies_depends_on_idx"
  ON "issue_dependencies" ("depends_on_issue_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "issue_dependencies_company_idx"
  ON "issue_dependencies" ("company_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Phase 19: coordinator_sessions (Coordinator Mode)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "coordinator_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "coordinator_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "parent_issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'active',
  "max_parallel_workers" integer NOT NULL DEFAULT 5,
  "delegation_strategy" text NOT NULL DEFAULT 'round_robin',
  "config" jsonb NOT NULL DEFAULT '{}',
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "coordinator_sessions_company_coordinator_idx"
  ON "coordinator_sessions" ("company_id", "coordinator_agent_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "coordinator_sessions_company_parent_issue_idx"
  ON "coordinator_sessions" ("company_id", "parent_issue_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "coordinator_sessions_company_status_idx"
  ON "coordinator_sessions" ("company_id", "status");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Phase 19: worker_tasks (Coordinator Mode)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "worker_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "coordinator_session_id" uuid NOT NULL REFERENCES "coordinator_sessions"("id") ON DELETE CASCADE,
  "parent_issue_id" uuid NOT NULL REFERENCES "issues"("id"),
  "sub_issue_id" uuid REFERENCES "issues"("id") ON DELETE SET NULL,
  "worker_agent_id" uuid REFERENCES "agents"("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "summary" text,
  "result" jsonb,
  "delegated_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "worker_tasks_company_session_idx"
  ON "worker_tasks" ("company_id", "coordinator_session_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "worker_tasks_company_parent_issue_status_idx"
  ON "worker_tasks" ("company_id", "parent_issue_id", "status");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "worker_tasks_company_worker_status_idx"
  ON "worker_tasks" ("company_id", "worker_agent_id", "status");
