CREATE TYPE "public"."api_key_type" AS ENUM('MCP', 'ADMIN');--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "type" "api_key_type" DEFAULT 'MCP' NOT NULL;--> statement-breakpoint
CREATE INDEX "api_keys_type_idx" ON "api_keys" USING btree ("type");