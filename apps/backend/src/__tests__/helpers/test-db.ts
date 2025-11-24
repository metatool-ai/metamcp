import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '../../db/schema'

// Create in-memory SQLite database for tests
export function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })

  // Create tables manually since we can't run PostgreSQL migrations on SQLite
  // This is a simplified schema for testing purposes
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      image TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT,
      client_name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL DEFAULT '[]',
      grant_types TEXT NOT NULL DEFAULT '[]',
      response_types TEXT NOT NULL DEFAULT '[]',
      token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
      scope TEXT NOT NULL DEFAULT 'admin',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE oauth_authorization_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'admin',
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_challenge TEXT,
      code_challenge_method TEXT,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE oauth_access_tokens (
      access_token TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'admin',
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  return { db, sqlite }
}

// Helper to reset database state between tests
export function clearTestDb(sqlite: Database) {
  sqlite.exec(`
    DELETE FROM oauth_access_tokens;
    DELETE FROM oauth_authorization_codes;
    DELETE FROM oauth_clients;
    DELETE FROM users;
  `)
}