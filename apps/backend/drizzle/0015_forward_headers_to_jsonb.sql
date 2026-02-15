-- Convert forward_headers from text[] to jsonb
-- Each array element h becomes a key-value pair {h: h} (1:1 mapping)

-- Step 1: Add new jsonb column
ALTER TABLE "mcp_servers" ADD COLUMN "forward_headers_new" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Step 2: Migrate existing array data to jsonb record
-- Each array element becomes a key-value pair where key = value (1:1 mapping)
UPDATE "mcp_servers"
SET "forward_headers_new" = (
  SELECT COALESCE(
    jsonb_object_agg(elem, elem),
    '{}'::jsonb
  )
  FROM unnest("forward_headers") AS elem
)
WHERE array_length("forward_headers", 1) > 0;

-- Step 3: Drop old column and rename new one
ALTER TABLE "mcp_servers" DROP COLUMN "forward_headers";
ALTER TABLE "mcp_servers" RENAME COLUMN "forward_headers_new" TO "forward_headers";
