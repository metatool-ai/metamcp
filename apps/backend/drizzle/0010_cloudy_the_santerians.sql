CREATE TABLE "rest_api_tools" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"description" text,
	"url" text NOT NULL,
	"integration_type" text DEFAULT 'REST' NOT NULL,
	"request_type" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"auth_value" text,
	"server_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rest_api_tools_unique_name_per_server_idx" UNIQUE("server_id","name")
);
--> statement-breakpoint
ALTER TABLE "rest_api_tools" ADD CONSTRAINT "rest_api_tools_server_id_mcp_servers_uuid_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rest_api_tools" ADD CONSTRAINT "rest_api_tools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rest_api_tools_server_id_idx" ON "rest_api_tools" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "rest_api_tools_user_id_idx" ON "rest_api_tools" USING btree ("user_id");