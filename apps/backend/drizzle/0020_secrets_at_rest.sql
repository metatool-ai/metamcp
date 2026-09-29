CREATE TABLE "encryption_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"wrapped_key" text NOT NULL,
	"kek_provider" text NOT NULL,
	"kek_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- API keys: keep only a SHA-256 digest and a short preview. Existing keys keep
-- working (same digest); the clear-text column is dropped by the next migration.
ALTER TABLE "api_keys" ADD COLUMN "key_hash" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_preview" text;--> statement-breakpoint
UPDATE "api_keys" SET
	"key_hash" = encode(sha256(convert_to("key", 'UTF8')), 'hex'),
	"key_preview" = left("key", 10) || '…' || right("key", 4);--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "key_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "key_preview" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash");--> statement-breakpoint
-- MetaMCP's OAuth authorization server: store digests of bearer tokens,
-- refresh tokens and client secrets instead of the values themselves.
UPDATE "oauth_access_tokens" SET
	"access_token" = encode(sha256(convert_to("access_token", 'UTF8')), 'hex'),
	"refresh_token" = CASE
		WHEN "refresh_token" IS NULL THEN NULL
		ELSE encode(sha256(convert_to("refresh_token", 'UTF8')), 'hex')
	END;--> statement-breakpoint
UPDATE "oauth_clients" SET
	"client_secret" = encode(sha256(convert_to("client_secret", 'UTF8')), 'hex')
	WHERE "client_secret" IS NOT NULL;--> statement-breakpoint
-- Authorization codes live for minutes: pending authorizations just restart.
DELETE FROM "oauth_authorization_codes";--> statement-breakpoint
-- Tokens issued by the identity provider at sign-in are not used by MetaMCP.
-- They are now stored encrypted (better-auth encryptOAuthTokens) and come back
-- at the next sign-in; drop the clear-text copies.
UPDATE "accounts" SET "access_token" = NULL, "refresh_token" = NULL, "id_token" = NULL
	WHERE "provider_id" <> 'credential';
