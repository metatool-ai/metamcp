CREATE TYPE "public"."group_membership_source" AS ENUM('manual', 'oidc');--> statement-breakpoint
CREATE TYPE "public"."share_level" AS ENUM('use', 'edit', 'manage');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_uuid" uuid NOT NULL,
	"user_id" text NOT NULL,
	"source" "group_membership_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_uuid_user_id_pk" PRIMARY KEY("group_uuid","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"role" "user_role",
	"system_key" text,
	"oidc_groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_system_key_unique" UNIQUE("system_key"),
	CONSTRAINT "groups_system_key_check" CHECK ("groups"."system_key" IS NULL OR "groups"."system_key" IN ('admins', 'everyone'))
);
--> statement-breakpoint
CREATE TABLE "resource_shares" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mcp_server_uuid" uuid,
	"namespace_uuid" uuid,
	"user_id" text,
	"group_uuid" uuid,
	"level" "share_level" DEFAULT 'use' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_shares_one_resource_check" CHECK (num_nonnulls("resource_shares"."mcp_server_uuid", "resource_shares"."namespace_uuid") = 1),
	CONSTRAINT "resource_shares_one_subject_check" CHECK (num_nonnulls("resource_shares"."user_id", "resource_shares"."group_uuid") = 1)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "external_groups" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "external_groups_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_uuid_groups_uuid_fk" FOREIGN KEY ("group_uuid") REFERENCES "public"."groups"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_namespace_uuid_namespaces_uuid_fk" FOREIGN KEY ("namespace_uuid") REFERENCES "public"."namespaces"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_group_uuid_groups_uuid_fk" FOREIGN KEY ("group_uuid") REFERENCES "public"."groups"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_members_user_id_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_lower_unique_idx" ON "groups" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "resource_shares_mcp_server_uuid_idx" ON "resource_shares" USING btree ("mcp_server_uuid");--> statement-breakpoint
CREATE INDEX "resource_shares_namespace_uuid_idx" ON "resource_shares" USING btree ("namespace_uuid");--> statement-breakpoint
CREATE INDEX "resource_shares_user_id_idx" ON "resource_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resource_shares_group_uuid_idx" ON "resource_shares" USING btree ("group_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_shares_server_user_unique_idx" ON "resource_shares" USING btree ("mcp_server_uuid","user_id") WHERE "resource_shares"."mcp_server_uuid" IS NOT NULL AND "resource_shares"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_shares_server_group_unique_idx" ON "resource_shares" USING btree ("mcp_server_uuid","group_uuid") WHERE "resource_shares"."mcp_server_uuid" IS NOT NULL AND "resource_shares"."group_uuid" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_shares_namespace_user_unique_idx" ON "resource_shares" USING btree ("namespace_uuid","user_id") WHERE "resource_shares"."namespace_uuid" IS NOT NULL AND "resource_shares"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_shares_namespace_group_unique_idx" ON "resource_shares" USING btree ("namespace_uuid","group_uuid") WHERE "resource_shares"."namespace_uuid" IS NOT NULL AND "resource_shares"."group_uuid" IS NOT NULL;--> statement-breakpoint
-- RBAC data migration -------------------------------------------------------
-- 1) System groups. "Everyone" implicitly contains every user (no stored rows).
INSERT INTO "groups" ("name", "description", "role", "system_key") VALUES
  ('Administrators', 'Members are MetaMCP administrators: they manage users, groups, settings and every resource.', 'admin', 'admins'),
  ('Everyone', 'Every signed-in user. Share a resource with this group to make it available to the whole organisation.', NULL, 'everyone')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 2) Existing accounts keep what they could do before RBAC (create and manage
--    their own resources); the earliest account becomes the first administrator.
UPDATE "users" SET "role" = 'editor';
--> statement-breakpoint
UPDATE "users" SET "role" = 'admin'
WHERE "id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC, "id" ASC LIMIT 1);
--> statement-breakpoint
-- 3) Formerly "public" resources (user_id IS NULL) become organisation-owned:
--    still usable by everyone, but only administrators can modify them.
INSERT INTO "resource_shares" ("mcp_server_uuid", "group_uuid", "level")
SELECT s."uuid", g."uuid", 'use'
FROM "mcp_servers" s CROSS JOIN "groups" g
WHERE s."user_id" IS NULL AND g."system_key" = 'everyone'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "resource_shares" ("namespace_uuid", "group_uuid", "level")
SELECT n."uuid", g."uuid", 'use'
FROM "namespaces" n CROSS JOIN "groups" g
WHERE n."user_id" IS NULL AND g."system_key" = 'everyone'
ON CONFLICT DO NOTHING;
