ALTER TABLE "mcp_servers" ADD COLUMN "forward_headers" text[] DEFAULT '{}'::text[] NOT NULL;
-- Rollback: ALTER TABLE "mcp_servers" DROP COLUMN "forward_headers";