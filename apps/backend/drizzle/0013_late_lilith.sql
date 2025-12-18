ALTER TABLE "endpoints" ADD COLUMN "enable_max_rate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "enable_client_max_rate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "max_rate" integer;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "max_rate_seconds" integer;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "client_max_rate" integer;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "client_max_rate_seconds" integer;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "client_max_rate_strategy" text;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "client_max_rate_strategy_key" text;