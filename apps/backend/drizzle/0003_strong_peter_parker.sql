ALTER TABLE "endpoints" DROP CONSTRAINT "endpoints_name_user_unique_idx";--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_name_unique" UNIQUE("name");