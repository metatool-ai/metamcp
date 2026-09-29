import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a real, migrated Postgres database:
 *
 *   INTEGRATION_DATABASE_URL=postgresql://user:pass@localhost:5432/metamcp_test \
 *     pnpm --filter backend test:integration
 *
 * The database is wiped between tests: never point this at real data.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // Tests share one database: run files one after another.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.INTEGRATION_DATABASE_URL ?? "",
      BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
      // Obviously fake fixed key (32 bytes of 7) protecting the test data keys
      SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      SECRETS_KEY_ACTIVATION_DELAY_SECONDS: "0",
      APP_URL: "http://localhost:12008",
      LOG_LEVEL: "none",
    },
  },
});
