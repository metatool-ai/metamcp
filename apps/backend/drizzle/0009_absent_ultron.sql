DELETE FROM "docker_sessions";--> statement-breakpoint
CREATE TYPE "public"."docker_session_status" AS ENUM('RUNNING', 'STOPPED', 'ERROR', 'REMOVED', 'NOT_FOUND');--> statement-breakpoint
ALTER TABLE "docker_sessions" ALTER COLUMN "status" SET DEFAULT 'RUNNING'::"public"."docker_session_status";--> statement-breakpoint
ALTER TABLE "docker_sessions" ALTER COLUMN "status" SET DATA TYPE "public"."docker_session_status" USING "status"::"public"."docker_session_status";