-- Add user_id column to oauth_clients table to track which user registered the OAuth client
ALTER TABLE "oauth_clients" ADD COLUMN "user_id" text;

-- Add foreign key constraint
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS "oauth_clients_user_id_idx" ON "oauth_clients" ("user_id");

-- Try to populate user_id from oauth_authorization_codes for existing clients
-- This finds the first user who authorized each client
UPDATE "oauth_clients" oc
SET "user_id" = (
  SELECT oac."user_id"
  FROM "oauth_authorization_codes" oac
  WHERE oac."client_id" = oc."client_id"
  ORDER BY oac."created_at" ASC
  LIMIT 1
)
WHERE oc."user_id" IS NULL;
