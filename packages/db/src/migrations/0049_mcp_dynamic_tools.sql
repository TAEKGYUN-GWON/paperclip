-- Phase 16: MCP Dynamic Tool Registration
-- Stores MCP server connection configurations and status.
-- Adapted from Claude Code services/mcp/types.ts McpServerConfig.

CREATE TABLE "mcp_servers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "name" text NOT NULL,
  "display_name" text NOT NULL,
  "scope" text NOT NULL DEFAULT 'company',
  "scope_id" uuid,
  "transport_type" text NOT NULL DEFAULT 'http',
  "config" jsonb NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'active',
  "last_connected_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "mcp_servers_company_name_uq_idx"
  ON "mcp_servers" ("company_id", "name");--> statement-breakpoint

CREATE INDEX "mcp_servers_company_scope_idx"
  ON "mcp_servers" ("company_id", "scope", "scope_id");--> statement-breakpoint

CREATE INDEX "mcp_servers_company_status_idx"
  ON "mcp_servers" ("company_id", "status");
