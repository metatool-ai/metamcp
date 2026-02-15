ALTER TABLE "mcp_servers" ALTER COLUMN "forward_headers" SET DATA TYPE jsonb
  USING COALESCE(
    (SELECT jsonb_object_agg(elem, elem) FROM unnest(forward_headers) AS elem WHERE elem IS NOT NULL),
    '{}'::jsonb
  );--> statement-breakpoint
ALTER TABLE "mcp_servers" ALTER COLUMN "forward_headers" SET DEFAULT '{}'::jsonb;