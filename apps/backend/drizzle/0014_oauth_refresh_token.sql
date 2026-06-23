ALTER TABLE "oauth_access_tokens" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_refresh_token_idx" ON "oauth_access_tokens" USING btree ("refresh_token");