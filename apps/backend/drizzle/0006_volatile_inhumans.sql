CREATE TYPE "public"."mcp_server_error_status" AS ENUM('NONE', 'ERROR');--> statement-breakpoint
ALTER TABLE "namespace_server_mappings" ADD COLUMN "error_status" "mcp_server_error_status" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
CREATE INDEX "namespace_server_mappings_error_status_idx" ON "namespace_server_mappings" USING btree ("error_status");