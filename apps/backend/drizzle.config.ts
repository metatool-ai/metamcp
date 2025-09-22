/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { defineConfig } from "drizzle-kit";
// @ts-expect-error outside dir
const { DATABASE_TYPE, DATABASE_URL } = process.env;

export default defineConfig({
  out: `./drizzle-${DATABASE_TYPE}`,
  schema: "./src/db/schema.ts",
  dialect: DATABASE_TYPE === "sqlite" ? "sqlite" : "postgresql",
  dbCredentials: {
    url: DATABASE_URL!,
  },
});
