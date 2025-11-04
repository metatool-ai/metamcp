-- Create mcp_server_call_logs table for auditing calls from MetaMCP to real MCP servers
CREATE TABLE IF NOT EXISTS "mcp_server_call_logs" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text,
	"user_id" text,
	"session_id" text,
	"endpoint_name" text,
	"namespace_uuid" text,
	"mcp_server_uuid" text,
	"mcp_server_name" text,
	"tool_name" text NOT NULL,
	"tool_arguments" jsonb,
	"result" jsonb,
	"status" text NOT NULL,
	"error_message" text,
	"duration_ms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add foreign key constraints
DO $$ BEGIN
 ALTER TABLE "mcp_server_call_logs" ADD CONSTRAINT "mcp_server_call_logs_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "mcp_server_call_logs" ADD CONSTRAINT "mcp_server_call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "mcp_server_call_logs_client_id_idx" ON "mcp_server_call_logs" USING btree ("client_id");
CREATE INDEX IF NOT EXISTS "mcp_server_call_logs_user_id_idx" ON "mcp_server_call_logs" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "mcp_server_call_logs_session_id_idx" ON "mcp_server_call_logs" USING btree ("session_id");
CREATE INDEX IF NOT EXISTS "mcp_server_call_logs_mcp_server_uuid_idx" ON "mcp_server_call_logs" USING btree ("mcp_server_uuid");
CREATE INDEX IF NOT EXISTS "mcp_server_call_logs_tool_name_idx" ON "mcp_server_call_logs" USING btree ("tool_name");
CREATE INDEX IF NOT EXISTS "mcp_server_call_logs_created_at_idx" ON "mcp_server_call_logs" USING btree ("created_at");
