CREATE TYPE "public"."api_key_scope" AS ENUM('user', 'endpoints');--> statement-breakpoint
CREATE TABLE "api_key_endpoints" (
	"api_key_uuid" uuid NOT NULL,
	"endpoint_uuid" uuid NOT NULL,
	CONSTRAINT "api_key_endpoints_api_key_uuid_endpoint_uuid_pk" PRIMARY KEY("api_key_uuid","endpoint_uuid")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "scope" "api_key_scope" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_endpoints" ADD CONSTRAINT "api_key_endpoints_api_key_uuid_api_keys_uuid_fk" FOREIGN KEY ("api_key_uuid") REFERENCES "public"."api_keys"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_endpoints" ADD CONSTRAINT "api_key_endpoints_endpoint_uuid_endpoints_uuid_fk" FOREIGN KEY ("endpoint_uuid") REFERENCES "public"."endpoints"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_endpoints_endpoint_idx" ON "api_key_endpoints" USING btree ("endpoint_uuid");