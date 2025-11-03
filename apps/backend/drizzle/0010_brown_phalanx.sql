CREATE TYPE "public"."tool_access_type" AS ENUM('read', 'write');--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "access_type" "tool_access_type" DEFAULT 'write' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "can_access_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "tools_access_type_idx" ON "tools" USING btree ("access_type");
