CREATE TYPE "public"."tool_execution_status" AS ENUM('SUCCESS', 'ERROR', 'PENDING');--> statement-breakpoint
CREATE TABLE "tool_execution_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"mcp_server_uuid" uuid,
	"tool_name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"status" "tool_execution_status" DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"execution_time_ms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_project_uuid_projects_uuid_fk";
--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_project_uuid_projects_uuid_fk";
--> statement-breakpoint
ALTER TABLE "tool_execution_logs" ADD CONSTRAINT "tool_execution_logs_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_execution_logs_mcp_server_uuid_idx" ON "tool_execution_logs" USING btree ("mcp_server_uuid");--> statement-breakpoint
CREATE INDEX "tool_execution_logs_tool_name_idx" ON "tool_execution_logs" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "tool_execution_logs_created_at_idx" ON "tool_execution_logs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_uuid_projects_uuid_fk" FOREIGN KEY ("project_uuid") REFERENCES "public"."projects"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_project_uuid_projects_uuid_fk" FOREIGN KEY ("project_uuid") REFERENCES "public"."projects"("uuid") ON DELETE cascade ON UPDATE no action;