CREATE TYPE "public"."mcp_request_audit_status" AS ENUM('SUCCESS', 'ERROR');--> statement-breakpoint
CREATE TABLE "mcp_request_audit_logs" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_name" text NOT NULL,
	"namespace_uuid" uuid,
	"session_id" text NOT NULL,
	"auth_method" text NOT NULL,
	"api_key_uuid" uuid,
	"api_key_user_id" text,
	"oauth_user_id" text,
	"mcp_server_uuid" uuid,
	"mcp_server_name" text,
	"tool_name" text NOT NULL,
	"status" "mcp_request_audit_status" NOT NULL,
	"duration_ms" integer NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_request_audit_logs" ADD CONSTRAINT "mcp_request_audit_logs_namespace_uuid_namespaces_uuid_fk" FOREIGN KEY ("namespace_uuid") REFERENCES "public"."namespaces"("uuid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_request_audit_logs" ADD CONSTRAINT "mcp_request_audit_logs_api_key_uuid_api_keys_uuid_fk" FOREIGN KEY ("api_key_uuid") REFERENCES "public"."api_keys"("uuid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_request_audit_logs" ADD CONSTRAINT "mcp_request_audit_logs_api_key_user_id_users_id_fk" FOREIGN KEY ("api_key_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_request_audit_logs" ADD CONSTRAINT "mcp_request_audit_logs_oauth_user_id_users_id_fk" FOREIGN KEY ("oauth_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_request_audit_logs" ADD CONSTRAINT "mcp_request_audit_logs_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_created_at_idx" ON "mcp_request_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_endpoint_name_idx" ON "mcp_request_audit_logs" USING btree ("endpoint_name");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_namespace_uuid_idx" ON "mcp_request_audit_logs" USING btree ("namespace_uuid");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_session_id_idx" ON "mcp_request_audit_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_api_key_uuid_idx" ON "mcp_request_audit_logs" USING btree ("api_key_uuid");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_api_key_user_id_idx" ON "mcp_request_audit_logs" USING btree ("api_key_user_id");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_oauth_user_id_idx" ON "mcp_request_audit_logs" USING btree ("oauth_user_id");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_mcp_server_uuid_idx" ON "mcp_request_audit_logs" USING btree ("mcp_server_uuid");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_mcp_server_name_idx" ON "mcp_request_audit_logs" USING btree ("mcp_server_name");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_tool_name_idx" ON "mcp_request_audit_logs" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_status_idx" ON "mcp_request_audit_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_api_key_user_created_at_idx" ON "mcp_request_audit_logs" USING btree ("api_key_user_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_oauth_user_created_at_idx" ON "mcp_request_audit_logs" USING btree ("oauth_user_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_api_key_created_at_idx" ON "mcp_request_audit_logs" USING btree ("api_key_uuid","created_at");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_namespace_created_at_idx" ON "mcp_request_audit_logs" USING btree ("namespace_uuid","created_at");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_status_created_at_idx" ON "mcp_request_audit_logs" USING btree ("status","created_at");