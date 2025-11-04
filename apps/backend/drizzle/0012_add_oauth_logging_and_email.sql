-- Migration: Add OAuth request logging and client email
-- Adds ability to track OAuth requests for auditing and adds email field to clients

-- Step 1: Add email column to oauth_clients table
ALTER TABLE "oauth_clients" ADD COLUMN "email" text;

-- Step 2: Create oauth_request_logs table
CREATE TABLE IF NOT EXISTS "oauth_request_logs" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text,
	"user_id" text,
	"request_type" text NOT NULL,
	"request_method" text NOT NULL,
	"request_path" text NOT NULL,
	"request_query" jsonb,
	"request_headers" jsonb,
	"request_body" jsonb,
	"response_status" text NOT NULL,
	"response_body" jsonb,
	"error_message" text,
	"ip_address" text,
	"user_agent" text,
	"duration_ms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Step 3: Add foreign key constraints
ALTER TABLE "oauth_request_logs" ADD CONSTRAINT "oauth_request_logs_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "oauth_request_logs" ADD CONSTRAINT "oauth_request_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;

-- Step 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS "oauth_request_logs_client_id_idx" ON "oauth_request_logs" ("client_id");
CREATE INDEX IF NOT EXISTS "oauth_request_logs_user_id_idx" ON "oauth_request_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "oauth_request_logs_request_type_idx" ON "oauth_request_logs" ("request_type");
CREATE INDEX IF NOT EXISTS "oauth_request_logs_created_at_idx" ON "oauth_request_logs" ("created_at");
