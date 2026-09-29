CREATE TABLE "mcp_server_snapshots" (
	"mcp_server_uuid" uuid PRIMARY KEY NOT NULL,
	"server_info" jsonb,
	"capabilities" jsonb NOT NULL,
	"tools" jsonb NOT NULL,
	"listed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_server_snapshots" ADD CONSTRAINT "mcp_server_snapshots_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE cascade ON UPDATE no action;