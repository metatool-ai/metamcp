import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Use an explicit pg Pool so we can attach a global error handler.
// This prevents unhandled 'error' events from bringing down the Node process
// when the database terminates idle connections (e.g., during maintenance).
export const pool = new Pool({
  connectionString: DATABASE_URL,
});

pool.on("error", (err) => {
  // Log and continue so the process doesn't crash on idle client errors.
  // pg-pool will create a new client on the next checkout automatically.
  console.error("PostgreSQL pool error (ignored):", err);
});

export const db = drizzle(pool, { schema });
