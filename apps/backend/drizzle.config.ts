/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { defineConfig } from "drizzle-kit";
export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // @ts-expect-error outside dir
    url: process.env.DATABASE_URL!,
  },
});
