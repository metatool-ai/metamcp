import { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

export const mcpServerTypeEnum = ["STDIO", "SSE", "STREAMABLE_HTTP"] as const;
export const mcpServerStatusEnum = ["ACTIVE", "INACTIVE"] as const;
export const mcpServerErrorStatusEnum = ["NONE", "CONNECTION_ERROR", "AUTH_ERROR", "RUNTIME_ERROR"] as const;

export const mcpServersTable = sqliteTable(
  "mcp_servers",
  {
    uuid: text("uuid").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type", { enum: mcpServerTypeEnum })
      .notNull()
      .default("STDIO"),
    command: text("command"),
    args: text("args", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    env: text("env", { mode: "json" })
      .$type<{ [key: string]: string }>()
      .notNull()
      .default({}),
    url: text("url"),
    error_status: text("error_status", { enum: mcpServerErrorStatusEnum })
      .notNull()
      .default("NONE"),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    bearerToken: text("bearer_token"),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("mcp_servers_type_idx").on(table.type),
    index("mcp_servers_user_id_idx").on(table.user_id),
    index("mcp_servers_error_status_idx").on(table.error_status),
    // Allow same name for different users, but unique within user scope (including public)
    unique("mcp_servers_name_user_unique_idx").on(table.name, table.user_id),
  ],
);

export const oauthSessionsTable = sqliteTable(
  "oauth_sessions",
  {
    uuid: text("uuid").primaryKey().$defaultFn(() => crypto.randomUUID()),
    mcp_server_uuid: text("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
    client_information: text("client_information", { mode: "json" })
      .$type<OAuthClientInformation>()
      .notNull(),
    tokens: text("tokens", { mode: "json" }).$type<OAuthTokens>(),
    code_verifier: text("code_verifier"),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("oauth_sessions_mcp_server_uuid_idx").on(table.mcp_server_uuid),
    unique("oauth_sessions_unique_per_server_idx").on(table.mcp_server_uuid),
  ],
);

export const toolsTable = sqliteTable(
  "tools",
  {
    uuid: text("uuid").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    description: text("description"),
    toolSchema: text("tool_schema", { mode: "json" })
      .$type<{
        type: "object";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties?: Record<string, any>;
        required?: string[];
      }>()
      .notNull(),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    mcp_server_uuid: text("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
  },
  (table) => [
    index("tools_mcp_server_uuid_idx").on(table.mcp_server_uuid),
    unique("tools_unique_tool_name_per_server_idx").on(
      table.mcp_server_uuid,
      table.name,
    ),
  ],
);

// Better-auth tables
export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer({ mode: 'boolean' }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessionsTable = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
});

export const accountsTable = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const verificationsTable = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Namespaces table
export const namespacesTable = sqliteTable(
  "namespaces",
  {
    uuid: text("uuid").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    description: text("description"),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("namespaces_user_id_idx").on(table.user_id),
    // Allow same name for different users, but unique within user scope (including public)
    unique("namespaces_name_user_unique_idx").on(table.name, table.user_id),
  ],
);

// Endpoints table - public routing endpoints that map to namespaces
export const endpointsTable = sqliteTable(
  "endpoints",
  {
    uuid: text("uuid").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    description: text("description"),
    namespace_uuid: text("namespace_uuid")
      .notNull()
      .references(() => namespacesTable.uuid, { onDelete: "cascade" }),
    enable_api_key_auth: integer({ mode: 'boolean' }).notNull().default(true),
    enable_oauth: integer({ mode: 'boolean' }).notNull().default(false),
    use_query_param_auth: integer({ mode: 'boolean' })
      .notNull()
      .default(false),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("endpoints_namespace_uuid_idx").on(table.namespace_uuid),
    index("endpoints_user_id_idx").on(table.user_id),
    // Endpoints must be globally unique because they're used in URLs like /metamcp/[name]/sse
    unique("endpoints_name_unique").on(table.name),
  ],
);

// Many-to-many relationship table between namespaces and mcp servers
export const namespaceServerMappingsTable = sqliteTable(
  "namespace_server_mappings",
  {
    uuid: text("uuid").primaryKey().$defaultFn(() => crypto.randomUUID()),
    namespace_uuid: text("namespace_uuid")
      .notNull()
      .references(() => namespacesTable.uuid, { onDelete: "cascade" }),
    mcp_server_uuid: text("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
    status: text("status", { enum: mcpServerStatusEnum })
      .notNull()
      .default("ACTIVE"),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("namespace_server_mappings_namespace_uuid_idx").on(
      table.namespace_uuid,
    ),
    index("namespace_server_mappings_mcp_server_uuid_idx").on(
      table.mcp_server_uuid,
    ),
    index("namespace_server_mappings_status_idx").on(table.status),
    unique("namespace_server_mappings_unique_idx").on(
      table.namespace_uuid,
      table.mcp_server_uuid,
    ),
  ],
);

// Many-to-many relationship table between namespaces and tools for status control
export const namespaceToolMappingsTable = sqliteTable(
  "namespace_tool_mappings",
  {
    uuid: text("uuid").primaryKey().$defaultFn(() => crypto.randomUUID()),
    namespace_uuid: text("namespace_uuid")
      .notNull()
      .references(() => namespacesTable.uuid, { onDelete: "cascade" }),
    tool_uuid: text("tool_uuid")
      .notNull()
      .references(() => toolsTable.uuid, { onDelete: "cascade" }),
    mcp_server_uuid: text("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
    status: text("status", { enum: mcpServerStatusEnum })
      .notNull()
      .default("ACTIVE"),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    override_name: text("override_name"),
    override_description: text("override_description"),
  },
  (table) => [
    index("namespace_tool_mappings_namespace_uuid_idx").on(
      table.namespace_uuid,
    ),
    index("namespace_tool_mappings_tool_uuid_idx").on(table.tool_uuid),
    index("namespace_tool_mappings_mcp_server_uuid_idx").on(
      table.mcp_server_uuid,
    ),
    index("namespace_tool_mappings_status_idx").on(table.status),
    unique("namespace_tool_mappings_unique_idx").on(
      table.namespace_uuid,
      table.tool_uuid,
    ),
  ],
);

// API Keys table
export const apiKeysTable = sqliteTable(
  "api_keys",
  {
    uuid: text("uuid").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    key: text("key").notNull().unique(),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    is_active: integer({ mode: 'boolean' }).notNull().default(true),
  },
  (table) => [
    index("api_keys_user_id_idx").on(table.user_id),
    index("api_keys_key_idx").on(table.key),
    index("api_keys_is_active_idx").on(table.is_active),
    unique("api_keys_name_per_user_idx").on(table.user_id, table.name),
  ],
);

// Configuration table for app-wide settings
export const configTable = sqliteTable("config", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  created_at: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updated_at: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// OAuth Registered Clients table
export const oauthClientsTable = sqliteTable("oauth_clients", {
  client_id: text("client_id").primaryKey(),
  client_secret: text("client_secret"),
  client_name: text("client_name").notNull(),
  redirect_uris: text("redirect_uris", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  grant_types: text("grant_types", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(["authorization_code", "refresh_token"]),
  response_types: text("response_types", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(["code"]),
  token_endpoint_auth_method: text("token_endpoint_auth_method")
    .notNull()
    .default("none"),
  scope: text("scope").default("admin"),
  client_uri: text("client_uri"),
  logo_uri: text("logo_uri"),
  contacts: text("contacts", { mode: "json" }).$type<string[]>(),
  tos_uri: text("tos_uri"),
  policy_uri: text("policy_uri"),
  software_id: text("software_id"),
  software_version: text("software_version"),
  created_at: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updated_at: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// OAuth Authorization Codes table
export const oauthAuthorizationCodesTable = sqliteTable(
  "oauth_authorization_codes",
  {
    code: text("code").primaryKey(),
    client_id: text("client_id")
      .notNull()
      .references(() => oauthClientsTable.client_id, { onDelete: "cascade" }),
    redirect_uri: text("redirect_uri").notNull(),
    scope: text("scope").notNull().default("admin"),
    user_id: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    code_challenge: text("code_challenge"),
    code_challenge_method: text("code_challenge_method"),
    expires_at: integer("expires_at", { mode: "timestamp" }).notNull(),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("oauth_authorization_codes_client_id_idx").on(table.client_id),
    index("oauth_authorization_codes_user_id_idx").on(table.user_id),
    index("oauth_authorization_codes_expires_at_idx").on(table.expires_at),
  ],
);

// OAuth Access Tokens table
export const oauthAccessTokensTable = sqliteTable(
  "oauth_access_tokens",
  {
    access_token: text("access_token").primaryKey(),
    client_id: text("client_id")
      .notNull()
      .references(() => oauthClientsTable.client_id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("admin"),
    expires_at: integer("expires_at", { mode: "timestamp" }).notNull(),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("oauth_access_tokens_client_id_idx").on(table.client_id),
    index("oauth_access_tokens_user_id_idx").on(table.user_id),
    index("oauth_access_tokens_expires_at_idx").on(table.expires_at),
  ],
);
