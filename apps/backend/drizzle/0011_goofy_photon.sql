ALTER TABLE "namespace_tool_mappings"
  ADD COLUMN IF NOT EXISTS "override_annotations" jsonb DEFAULT NULL;
