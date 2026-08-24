ALTER TABLE "endpoints" DROP CONSTRAINT IF EXISTS "endpoints_name_unique";--> statement-breakpoint
ALTER TABLE "endpoints" DROP CONSTRAINT IF EXISTS "endpoints_name_unique_idx";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP CONSTRAINT IF EXISTS "mcp_servers_name_unique_idx";--> statement-breakpoint
ALTER TABLE "namespaces" DROP CONSTRAINT IF EXISTS "namespaces_name_unique";--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "namespaces" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "endpoints_user_id_idx" ON "endpoints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_user_id_idx" ON "mcp_servers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "namespaces_user_id_idx" ON "namespaces" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_name_user_unique_idx" UNIQUE("name","user_id");--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_name_user_unique_idx" UNIQUE("name","user_id");--> statement-breakpoint
ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_name_user_unique_idx" UNIQUE("name","user_id");--> statement-breakpoint
ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_name_regex_check" CHECK (
        name ~ '^[a-zA-Z0-9_-]+$'
      );