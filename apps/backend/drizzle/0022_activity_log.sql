CREATE TYPE "public"."activity_actor_type" AS ENUM('user', 'api_key', 'system');--> statement-breakpoint
CREATE TYPE "public"."activity_outcome" AS ENUM('success', 'denied', 'failure');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "activity_actor_type" NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"actor_name" text,
	"action" text NOT NULL,
	"category" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" "activity_outcome" DEFAULT 'success' NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_actor_id_idx" ON "activity_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_category_idx" ON "activity_logs" USING btree ("category","created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_target_id_idx" ON "activity_logs" USING btree ("target_id");--> statement-breakpoint
-- The activity log is append-only: entries can be removed by the retention
-- job but never modified.
CREATE FUNCTION "activity_logs_reject_update"() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'activity_logs is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "activity_logs_append_only"
	BEFORE UPDATE ON "activity_logs"
	FOR EACH ROW EXECUTE FUNCTION "activity_logs_reject_update"();
