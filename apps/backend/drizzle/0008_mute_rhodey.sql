ALTER TABLE "docker_sessions" DROP CONSTRAINT "docker_sessions_port_unique_idx";--> statement-breakpoint
DROP INDEX "docker_sessions_port_idx";--> statement-breakpoint
ALTER TABLE "docker_sessions" DROP COLUMN "port";