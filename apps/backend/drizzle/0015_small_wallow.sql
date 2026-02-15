-- Step 1: Add temporary jsonb column
ALTER TABLE "mcp_servers" ADD COLUMN "forward_headers_new" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
-- Step 2: Convert existing text[] data to jsonb record {header: header}
UPDATE "mcp_servers" SET "forward_headers_new" = COALESCE(
  (SELECT jsonb_object_agg(elem, elem) FROM unnest(forward_headers) AS elem WHERE elem IS NOT NULL),
  '{}'::jsonb
);--> statement-breakpoint
-- Step 3: Drop old text[] column
ALTER TABLE "mcp_servers" DROP COLUMN "forward_headers";--> statement-breakpoint
-- Step 4: Rename new column to forward_headers
ALTER TABLE "mcp_servers" RENAME COLUMN "forward_headers_new" TO "forward_headers";