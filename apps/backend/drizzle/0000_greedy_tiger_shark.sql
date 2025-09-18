CREATE TYPE "public"."mcp_server_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."mcp_server_type" AS ENUM('STDIO', 'SSE', 'STREAMABLE_HTTP');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "api_keys_key_unique" UNIQUE("key"),
	CONSTRAINT "api_keys_name_per_user_idx" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "config" (
	"id" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoints" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"namespace_uuid" uuid NOT NULL,
	"enable_api_key_auth" boolean DEFAULT true NOT NULL,
	"use_query_param_auth" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "endpoints_name_unique" UNIQUE("name"),
	CONSTRAINT "endpoints_name_unique_idx" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "mcp_server_type" DEFAULT 'STDIO' NOT NULL,
	"command" text,
	"args" text[] DEFAULT '{}'::text[] NOT NULL,
	"env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bearer_token" text,
	CONSTRAINT "mcp_servers_name_unique_idx" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "namespace_server_mappings" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_uuid" uuid NOT NULL,
	"mcp_server_uuid" uuid NOT NULL,
	"status" "mcp_server_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespace_server_mappings_unique_idx" UNIQUE("namespace_uuid","mcp_server_uuid")
);
--> statement-breakpoint
CREATE TABLE "namespace_tool_mappings" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_uuid" uuid NOT NULL,
	"tool_uuid" uuid NOT NULL,
	"mcp_server_uuid" uuid NOT NULL,
	"status" "mcp_server_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespace_tool_mappings_unique_idx" UNIQUE("namespace_uuid","tool_uuid")
);
--> statement-breakpoint
CREATE TABLE "namespaces" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespaces_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "oauth_sessions" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mcp_server_uuid" uuid NOT NULL,
	"client_information" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tokens" jsonb,
	"code_verifier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_sessions_unique_per_server_idx" UNIQUE("mcp_server_uuid")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"tool_schema" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mcp_server_uuid" uuid NOT NULL,
	CONSTRAINT "tools_unique_tool_name_per_server_idx" UNIQUE("mcp_server_uuid","name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_namespace_uuid_namespaces_uuid_fk" FOREIGN KEY ("namespace_uuid") REFERENCES "public"."namespaces"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_server_mappings" ADD CONSTRAINT "namespace_server_mappings_namespace_uuid_namespaces_uuid_fk" FOREIGN KEY ("namespace_uuid") REFERENCES "public"."namespaces"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_server_mappings" ADD CONSTRAINT "namespace_server_mappings_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_tool_mappings" ADD CONSTRAINT "namespace_tool_mappings_namespace_uuid_namespaces_uuid_fk" FOREIGN KEY ("namespace_uuid") REFERENCES "public"."namespaces"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_tool_mappings" ADD CONSTRAINT "namespace_tool_mappings_tool_uuid_tools_uuid_fk" FOREIGN KEY ("tool_uuid") REFERENCES "public"."tools"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_tool_mappings" ADD CONSTRAINT "namespace_tool_mappings_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_key_idx" ON "api_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "api_keys_is_active_idx" ON "api_keys" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "endpoints_namespace_uuid_idx" ON "endpoints" USING btree ("namespace_uuid");--> statement-breakpoint
CREATE INDEX "mcp_servers_type_idx" ON "mcp_servers" USING btree ("type");--> statement-breakpoint
CREATE INDEX "namespace_server_mappings_namespace_uuid_idx" ON "namespace_server_mappings" USING btree ("namespace_uuid");--> statement-breakpoint
CREATE INDEX "namespace_server_mappings_mcp_server_uuid_idx" ON "namespace_server_mappings" USING btree ("mcp_server_uuid");--> statement-breakpoint
CREATE INDEX "namespace_server_mappings_status_idx" ON "namespace_server_mappings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "namespace_tool_mappings_namespace_uuid_idx" ON "namespace_tool_mappings" USING btree ("namespace_uuid");--> statement-breakpoint
CREATE INDEX "namespace_tool_mappings_tool_uuid_idx" ON "namespace_tool_mappings" USING btree ("tool_uuid");--> statement-breakpoint
CREATE INDEX "namespace_tool_mappings_mcp_server_uuid_idx" ON "namespace_tool_mappings" USING btree ("mcp_server_uuid");--> statement-breakpoint
CREATE INDEX "namespace_tool_mappings_status_idx" ON "namespace_tool_mappings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "oauth_sessions_mcp_server_uuid_idx" ON "oauth_sessions" USING btree ("mcp_server_uuid");--> statement-breakpoint
CREATE INDEX "tools_mcp_server_uuid_idx" ON "tools" USING btree ("mcp_server_uuid");