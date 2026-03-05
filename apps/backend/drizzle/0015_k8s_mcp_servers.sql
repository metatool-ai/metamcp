ALTER TABLE "mcp_servers" ADD COLUMN "k8s_command_hash" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "k8s_service_url" text;--> statement-breakpoint
CREATE INDEX "mcp_servers_k8s_command_hash_idx" ON "mcp_servers" USING btree ("k8s_command_hash");
