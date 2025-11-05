-- Migration: Add admin role to users
-- Adds is_admin field to users table and makes first registered user an admin

-- Step 1: Add is_admin column to users table
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;

-- Step 2: Make the first registered user (oldest by created_at) an admin
-- This ensures whoever registered first automatically becomes admin
UPDATE "users"
SET "is_admin" = true
WHERE "id" = (
  SELECT "id" FROM "users"
  ORDER BY "created_at" ASC
  LIMIT 1
);

-- Step 3: Create index for performance (for filtering admin users)
CREATE INDEX IF NOT EXISTS "users_is_admin_idx" ON "users" ("is_admin");
