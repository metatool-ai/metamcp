ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_key_unique";--> statement-breakpoint
DROP INDEX "api_keys_key_idx";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "key";