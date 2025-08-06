CREATE TABLE "docker_sessions" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mcp_server_uuid" uuid NOT NULL,
	"container_id" text NOT NULL,
	"container_name" text NOT NULL,
	"port" integer NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "docker_sessions_container_id_unique" UNIQUE("container_id"),
	CONSTRAINT "docker_sessions_port_unique_idx" UNIQUE("port"),
	CONSTRAINT "docker_sessions_mcp_server_active_idx" UNIQUE("mcp_server_uuid")
);
--> statement-breakpoint
ALTER TABLE "docker_sessions" ADD CONSTRAINT "docker_sessions_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "docker_sessions_mcp_server_uuid_idx" ON "docker_sessions" USING btree ("mcp_server_uuid");--> statement-breakpoint
CREATE INDEX "docker_sessions_container_id_idx" ON "docker_sessions" USING btree ("container_id");--> statement-breakpoint
CREATE INDEX "docker_sessions_port_idx" ON "docker_sessions" USING btree ("port");--> statement-breakpoint
CREATE INDEX "docker_sessions_status_idx" ON "docker_sessions" USING btree ("status");