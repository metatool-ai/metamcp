ALTER TYPE "public"."mcp_server_type" ADD VALUE 'REST_API';--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "api_spec" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "base_url" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "auth_config" jsonb;