import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { Pool } from "pg";
import Database from 'better-sqlite3';

import * as schema from "./schema";

const { DATABASE_URL, POSTGRES_CA_CERT, DATABASE_TYPE } = process.env;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

console.log(DATABASE_URL, POSTGRES_CA_CERT, DATABASE_TYPE)

if (!DATABASE_TYPE || !['postgresql', 'sqlite'].includes(DATABASE_TYPE)) {
  throw new Error("DATABASE_TYPE must be either 'postgresql' or 'sqlite'");
}

let pool: Pool | null = null;
let sqliteDb: Database.Database | null = null;

// Initialize database connection based on type
if (DATABASE_TYPE === "postgresql") {
  // Use an explicit pg Pool so we can attach a global error handler.
  // This prevents unhandled 'error' events from bringing down the Node process
  // when the database terminates idle connections (e.g., during maintenance).
  pool = new Pool({
    connectionString: DATABASE_URL,
    ...(POSTGRES_CA_CERT && {
      ssl: {
        ca: POSTGRES_CA_CERT,
        rejectUnauthorized: true,
      },
    }),
  });

  pool.on("error", (err) => {
    // Log and continue so the process doesn't crash on idle client errors.
    // pg-pool will create a new client on the next checkout automatically.
    console.error("PostgreSQL pool error (ignored):", err);
  });
} else if (DATABASE_TYPE === "sqlite") {
  // Initialize SQLite database
  sqliteDb = new Database(DATABASE_URL);
  
  // Enable WAL mode for better concurrency
  sqliteDb.pragma('journal_mode = WAL');
  
  // Enable foreign keys
  sqliteDb.pragma('foreign_keys = ON');
}

// Create the appropriate Drizzle instance
export const db = DATABASE_TYPE === "sqlite" 
  ? drizzleSqlite(sqliteDb!, { schema })
  : drizzle(pool!, { schema });

// Graceful shutdown function
export const closeDatabase = async () => {
  if (DATABASE_TYPE === "postgresql" && pool) {
    await pool.end();
  } else if (DATABASE_TYPE === "sqlite" && sqliteDb) {
    sqliteDb.close();
  }
};
