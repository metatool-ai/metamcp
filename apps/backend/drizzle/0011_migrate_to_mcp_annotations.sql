-- Migration: Convert access_type to MCP ToolAnnotations
-- This migrates from the old access_type enum to the new annotations jsonb field

-- Step 1: Add annotations column to tools table
ALTER TABLE "tools" ADD COLUMN "annotations" jsonb DEFAULT '{}'::jsonb NOT NULL;

-- Step 2: Migrate existing access_type data to annotations
-- Convert "read" -> {"readOnlyHint": true}
-- Convert "write" -> {"readOnlyHint": false, "destructiveHint": true}
UPDATE "tools"
SET "annotations" = CASE
  WHEN "access_type" = 'read' THEN '{"readOnlyHint": true}'::jsonb
  WHEN "access_type" = 'write' THEN '{"readOnlyHint": false, "destructiveHint": true}'::jsonb
  ELSE '{}'::jsonb
END;

-- Step 3: Add override_annotations to namespace_tool_mappings
ALTER TABLE "namespace_tool_mappings" ADD COLUMN "override_annotations" jsonb;

-- Step 4: Drop old access_type column and index
DROP INDEX IF EXISTS "tools_access_type_idx";
ALTER TABLE "tools" DROP COLUMN IF EXISTS "access_type";

-- Step 5: Drop old enum type (if not used elsewhere)
-- Note: This might fail if the enum is still in use, which is fine
DO $$
BEGIN
  DROP TYPE IF EXISTS "tool_access_type";
EXCEPTION
  WHEN dependent_objects_still_exist THEN NULL;
END $$;
