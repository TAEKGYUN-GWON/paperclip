-- Phase 13: Declarative Workflow Engine
-- Extends routines with multi-agent DAG pipeline support.
-- Adapted from Claude Code skills/bundled/batch.ts 3-Phase orchestration.

-- Add workflow_definition to routines (nullable — existing routines unaffected)
ALTER TABLE "routines"
  ADD COLUMN IF NOT EXISTS "workflow_definition" jsonb;--> statement-breakpoint

-- Add workflow execution state to routine_runs (nullable)
ALTER TABLE "routine_runs"
  ADD COLUMN IF NOT EXISTS "workflow_execution_state" jsonb;--> statement-breakpoint

-- Workflow step definitions — static definition per routine
CREATE TABLE "workflow_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "routine_id" uuid NOT NULL REFERENCES "routines"("id") ON DELETE CASCADE,

  -- Step definition
  "step_index" integer NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',

  -- Agent selection (jsonb: { strategy, capabilities?, agentIds? })
  "agent_selector" jsonb NOT NULL DEFAULT '{"strategy":"round_robin"}',

  -- DAG dependency: array of step_index values this step depends on
  "depends_on_steps" integer[] NOT NULL DEFAULT '{}',

  -- Execution condition
  "condition" jsonb,

  -- Permissions and MCP servers for this step
  "required_permissions" text[] NOT NULL DEFAULT '{}',
  "mcp_servers" text[] NOT NULL DEFAULT '{}',

  -- Execution policy
  "timeout_minutes" integer NOT NULL DEFAULT 60,
  "retry_policy" jsonb,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "workflow_steps_company_routine_idx"
  ON "workflow_steps" ("company_id", "routine_id", "step_index");
