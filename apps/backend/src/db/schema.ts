import { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  McpServerErrorStatusEnum,
  McpServerStatusEnum,
  McpServerTypeEnum,
  UpstreamTokenResponse,
} from "@repo/zod-types";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// zod v4 types `ZodEnum.options` as a plain array, but drizzle's pgEnum requires
// a non-empty tuple. Re-assert the shape while preserving the literal union so
// the generated columns keep their narrow enum types.
function toEnumTuple<T extends string>(options: readonly T[]): [T, ...T[]] {
  return options as unknown as [T, ...T[]];
}

export const mcpServerTypeEnum = pgEnum(
  "mcp_server_type",
  toEnumTuple(McpServerTypeEnum.options),
);
export const mcpServerStatusEnum = pgEnum(
  "mcp_server_status",
  toEnumTuple(McpServerStatusEnum.options),
);
export const mcpServerErrorStatusEnum = pgEnum(
  "mcp_server_error_status",
  toEnumTuple(McpServerErrorStatusEnum.options),
);
export const mcpRequestAuditStatusEnum = pgEnum("mcp_request_audit_status", [
  "SUCCESS",
  "ERROR",
]);

export const mcpServersTable = pgTable(
  "mcp_servers",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    type: mcpServerTypeEnum("type")
      .notNull()
      .default(McpServerTypeEnum.enum.STDIO),
    command: text("command"),
    args: text("args")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    env: jsonb("env")
      .$type<{ [key: string]: string }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    url: text("url"),
    error_status: mcpServerErrorStatusEnum("error_status")
      .notNull()
      .default(McpServerErrorStatusEnum.enum.NONE),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    bearerToken: text("bearer_token"),
    headers: jsonb("headers")
      .$type<{ [key: string]: string }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    forward_headers: jsonb("forward_headers")
      .$type<{ [key: string]: string }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
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
    sql`CONSTRAINT mcp_servers_name_regex_check CHECK (
        name ~ '^[a-zA-Z0-9_-]+$'
      )`,
    sql`CONSTRAINT mcp_servers_url_check CHECK (
        (type = 'SSE' AND url IS NOT NULL AND command IS NULL AND url ~ '^https?://[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(:[0-9]+)?(/[a-zA-Z0-9-._~:/?#\[\]@!$&''()*+,;=]*)?$') OR
        (type = 'STDIO' AND url IS NULL AND command IS NOT NULL) OR
        (type = 'STREAMABLE_HTTP' AND url IS NOT NULL AND command IS NULL AND url ~ '^https?://[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(:[0-9]+)?(/[a-zA-Z0-9-._~:/?#\[\]@!$&''()*+,;=]*)?$')
      )`,
  ],
);

export const oauthSessionsTable = pgTable(
  "oauth_sessions",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    mcp_server_uuid: uuid("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
    client_information: jsonb("client_information")
      .$type<OAuthClientInformation>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Typed as UpstreamTokenResponse (RFC 6749 + .passthrough()) rather
    // than the MCP SDK's narrow OAuthTokens so providers' extra response
    // fields (Salesforce `instance_url`, OIDC `id_token`, Microsoft
    // `ext_expires_in`, ...) round-trip without `as unknown as` casts at
    // the call sites.
    tokens: jsonb("tokens").$type<UpstreamTokenResponse>(),
    code_verifier: text("code_verifier"),
    // CSRF defence (RFC 6749 §10.12). Generated server-side at the
    // authorize-redirect step (`DbOAuthClientProvider.state()`), compared
    // against the upstream's echoed `state` at token exchange, and cleared
    // on success (one-shot). NEVER returned to the frontend — the
    // serializer strips it.
    expected_state: text("expected_state"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("oauth_sessions_mcp_server_uuid_idx").on(table.mcp_server_uuid),
    unique("oauth_sessions_unique_per_server_idx").on(table.mcp_server_uuid),
  ],
);

export const toolsTable = pgTable(
  "tools",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    toolSchema: jsonb("tool_schema")
      .$type<{
        type: "object";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties?: Record<string, any>;
        required?: string[];
      }>()
      .notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    mcp_server_uuid: uuid("mcp_server_uuid")
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
export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
});

export const accountsTable = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verificationsTable = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Namespaces table
export const namespacesTable = pgTable(
  "namespaces",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("namespaces_user_id_idx").on(table.user_id),
    // Allow same name for different users, but unique within user scope (including public)
    unique("namespaces_name_user_unique_idx").on(table.name, table.user_id),
    sql`CONSTRAINT namespaces_name_regex_check CHECK (
        name ~ '^[a-zA-Z0-9_-]+$'
      )`,
  ],
);

// Endpoints table - public routing endpoints that map to namespaces
export const endpointsTable = pgTable(
  "endpoints",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    namespace_uuid: uuid("namespace_uuid")
      .notNull()
      .references(() => namespacesTable.uuid, { onDelete: "cascade" }),
    enable_api_key_auth: boolean("enable_api_key_auth").notNull().default(true),
    enable_oauth: boolean("enable_oauth").notNull().default(false),
    enable_max_rate: boolean("enable_max_rate").notNull().default(false),
    enable_client_max_rate: boolean("enable_client_max_rate")
      .notNull()
      .default(false),
    max_rate: integer("max_rate"),
    max_rate_seconds: integer("max_rate_seconds"),
    client_max_rate: integer("client_max_rate"),
    client_max_rate_seconds: integer("client_max_rate_seconds"),
    client_max_rate_strategy: text("client_max_rate_strategy"),
    client_max_rate_strategy_key: text("client_max_rate_strategy_key"),
    use_query_param_auth: boolean("use_query_param_auth")
      .notNull()
      .default(false),
    enable_metamcp_admin_tools: boolean("enable_metamcp_admin_tools")
      .notNull()
      .default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("endpoints_namespace_uuid_idx").on(table.namespace_uuid),
    index("endpoints_user_id_idx").on(table.user_id),
    // Endpoints must be globally unique because they're used in URLs like /metamcp/[name]/sse
    unique("endpoints_name_unique").on(table.name),
    sql`CONSTRAINT endpoints_name_url_compatible_check CHECK (
        name ~ '^[a-zA-Z0-9_-]+$'
      )`,
  ],
);

// Many-to-many relationship table between namespaces and mcp servers
export const namespaceServerMappingsTable = pgTable(
  "namespace_server_mappings",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    namespace_uuid: uuid("namespace_uuid")
      .notNull()
      .references(() => namespacesTable.uuid, { onDelete: "cascade" }),
    mcp_server_uuid: uuid("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
    status: mcpServerStatusEnum("status")
      .notNull()
      .default(McpServerStatusEnum.enum.ACTIVE),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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

// Many-to-many relationship table between namespaces and tools for status control and overrides
export const namespaceToolMappingsTable = pgTable(
  "namespace_tool_mappings",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    namespace_uuid: uuid("namespace_uuid")
      .notNull()
      .references(() => namespacesTable.uuid, { onDelete: "cascade" }),
    tool_uuid: uuid("tool_uuid")
      .notNull()
      .references(() => toolsTable.uuid, { onDelete: "cascade" }),
    mcp_server_uuid: uuid("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
    status: mcpServerStatusEnum("status")
      .notNull()
      .default(McpServerStatusEnum.enum.ACTIVE),
    override_name: text("override_name"),
    override_title: text("override_title"),
    override_description: text("override_description"),
    override_annotations: jsonb("override_annotations")
      .$type<Record<string, unknown> | null>()
      .default(sql`NULL`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
export const apiKeysTable = pgTable(
  "api_keys",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    key: text("key").notNull().unique(),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    is_active: boolean("is_active").notNull().default(true),
  },
  (table) => [
    index("api_keys_user_id_idx").on(table.user_id),
    index("api_keys_key_idx").on(table.key),
    index("api_keys_is_active_idx").on(table.is_active),
    unique("api_keys_name_per_user_idx").on(table.user_id, table.name),
  ],
);

export const mcpRequestAuditLogsTable = pgTable(
  "mcp_request_audit_logs",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    endpoint_name: text("endpoint_name").notNull(),
    namespace_uuid: uuid("namespace_uuid").references(
      () => namespacesTable.uuid,
      {
        onDelete: "set null",
      },
    ),
    session_id: text("session_id").notNull(),
    auth_method: text("auth_method").notNull(),
    api_key_uuid: uuid("api_key_uuid").references(() => apiKeysTable.uuid, {
      onDelete: "set null",
    }),
    api_key_user_id: text("api_key_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    oauth_user_id: text("oauth_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    mcp_server_uuid: uuid("mcp_server_uuid").references(
      () => mcpServersTable.uuid,
      {
        onDelete: "set null",
      },
    ),
    mcp_server_name: text("mcp_server_name"),
    tool_name: text("tool_name").notNull(),
    status: mcpRequestAuditStatusEnum("status").notNull(),
    duration_ms: integer("duration_ms").notNull(),
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mcp_request_audit_logs_created_at_idx").on(table.created_at),
    index("mcp_request_audit_logs_endpoint_name_idx").on(table.endpoint_name),
    index("mcp_request_audit_logs_namespace_uuid_idx").on(table.namespace_uuid),
    index("mcp_request_audit_logs_session_id_idx").on(table.session_id),
    index("mcp_request_audit_logs_api_key_uuid_idx").on(table.api_key_uuid),
    index("mcp_request_audit_logs_api_key_user_id_idx").on(
      table.api_key_user_id,
    ),
    index("mcp_request_audit_logs_oauth_user_id_idx").on(table.oauth_user_id),
    index("mcp_request_audit_logs_mcp_server_uuid_idx").on(
      table.mcp_server_uuid,
    ),
    index("mcp_request_audit_logs_mcp_server_name_idx").on(
      table.mcp_server_name,
    ),
    index("mcp_request_audit_logs_tool_name_idx").on(table.tool_name),
    index("mcp_request_audit_logs_status_idx").on(table.status),
    index("mcp_request_audit_logs_api_key_user_created_at_idx").on(
      table.api_key_user_id,
      table.created_at,
    ),
    index("mcp_request_audit_logs_oauth_user_created_at_idx").on(
      table.oauth_user_id,
      table.created_at,
    ),
    index("mcp_request_audit_logs_api_key_created_at_idx").on(
      table.api_key_uuid,
      table.created_at,
    ),
    index("mcp_request_audit_logs_namespace_created_at_idx").on(
      table.namespace_uuid,
      table.created_at,
    ),
    index("mcp_request_audit_logs_status_created_at_idx").on(
      table.status,
      table.created_at,
    ),
  ],
);

// Configuration table for app-wide settings
export const configTable = pgTable("config", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// OAuth Registered Clients table
export const oauthClientsTable = pgTable("oauth_clients", {
  client_id: text("client_id").primaryKey(),
  client_secret: text("client_secret"),
  client_name: text("client_name").notNull(),
  redirect_uris: text("redirect_uris")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  grant_types: text("grant_types")
    .array()
    .notNull()
    .default(sql`'{"authorization_code","refresh_token"}'::text[]`),
  response_types: text("response_types")
    .array()
    .notNull()
    .default(sql`'{"code"}'::text[]`),
  token_endpoint_auth_method: text("token_endpoint_auth_method")
    .notNull()
    .default("none"),
  scope: text("scope").default("admin"),
  client_uri: text("client_uri"),
  logo_uri: text("logo_uri"),
  contacts: text("contacts").array(),
  tos_uri: text("tos_uri"),
  policy_uri: text("policy_uri"),
  software_id: text("software_id"),
  software_version: text("software_version"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// OAuth Authorization Codes table
export const oauthAuthorizationCodesTable = pgTable(
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
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("oauth_authorization_codes_client_id_idx").on(table.client_id),
    index("oauth_authorization_codes_user_id_idx").on(table.user_id),
    index("oauth_authorization_codes_expires_at_idx").on(table.expires_at),
  ],
);

// OAuth Access Tokens table
export const oauthAccessTokensTable = pgTable(
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
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    refresh_token: text("refresh_token"),
    refresh_token_expires_at: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("oauth_access_tokens_client_id_idx").on(table.client_id),
    index("oauth_access_tokens_user_id_idx").on(table.user_id),
    index("oauth_access_tokens_expires_at_idx").on(table.expires_at),
    index("oauth_access_tokens_refresh_token_idx").on(table.refresh_token),
  ],
);
