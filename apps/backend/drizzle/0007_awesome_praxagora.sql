ALTER TABLE "docker_sessions" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "docker_sessions" ADD COLUMN "last_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "docker_sessions" ADD COLUMN "max_retries" integer DEFAULT 3 NOT NULL;