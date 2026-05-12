ALTER TABLE "oauth_sessions" ALTER COLUMN "client_information" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ALTER COLUMN "client_information" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD COLUMN "tokens_obtained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD COLUMN "token_expires_at" timestamp with time zone;
