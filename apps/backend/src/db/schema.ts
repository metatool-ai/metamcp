import { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  Implementation,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  McpServerErrorStatusEnum,
  McpServerStatusEnum,
  McpServerTypeEnum,
  UpstreamTokenResponse,
} from "@repo/zod-types";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  encryptedJson,
  encryptedStringMap,
  encryptedText,
} from "./encrypted-columns";

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
export const userRoleEnum = pgEnum("user_role", ["admin", "editor", "viewer"]);
export const shareLevelEnum = pgEnum("share_level", ["use", "edit", "manage"]);
export const groupMembershipSourceEnum = pgEnum("group_membership_source", [
  "manual",
  "oidc",
]);
export const activityActorTypeEnum = pgEnum("activity_actor_type", [
  "user",
  "api_key",
  "system",
]);
export const activityOutcomeEnum = pgEnum("activity_outcome", [
  "success",
  "denied",
  "failure",
]);
// What an API key may be used for: everything its owner can do ("user"), or
// only the MCP traffic of a list of endpoints ("endpoints").
export const apiKeyScopeEnum = pgEnum("api_key_scope", ["user", "endpoints"]);

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
    // Secrets are encrypted at rest (see lib/secrets): arguments often carry
    // connection strings, URLs can embed tokens, env and header values hold
    // credentials. Names (env keys, header names) stay readable.
    args: encryptedText("args", "mcp_servers.args")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    env: encryptedStringMap("env", "mcp_servers.env")
      .notNull()
      .default(sql`'{}'::jsonb`),
    url: encryptedText("url", "mcp_servers.url"),
    error_status: mcpServerErrorStatusEnum("error_status")
      .notNull()
      .default(McpServerErrorStatusEnum.enum.NONE),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    bearerToken: encryptedText("bearer_token", "mcp_servers.bearer_token"),
    headers: encryptedStringMap("headers", "mcp_servers.headers")
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
    // Upstream OAuth client registration and tokens, encrypted at rest.
    client_information: encryptedJson<OAuthClientInformation>(
      "client_information",
      "oauth_sessions.client_information",
    )
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Typed as UpstreamTokenResponse (RFC 6749 + .passthrough()) rather
    // than the MCP SDK's narrow OAuthTokens so providers' extra response
    // fields (Salesforce `instance_url`, OIDC `id_token`, Microsoft
    // `ext_expires_in`, ...) round-trip without `as unknown as` casts at
    // the call sites.
    tokens: encryptedJson<UpstreamTokenResponse>(
      "tokens",
      "oauth_sessions.tokens",
    ),
    code_verifier: encryptedText(
      "code_verifier",
      "oauth_sessions.code_verifier",
    ),
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
  // RBAC: base role. The effective role is the highest of this and the roles
  // granted by the user's groups (see lib/access).
  role: userRoleEnum("role").notNull().default("viewer"),
  // Disabled users cannot sign in, and their API keys / OAuth tokens stop working.
  disabled: boolean("disabled").notNull().default(false),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  // Last groups claim received from the OIDC provider (for admin visibility).
  externalGroups: text("external_groups")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  externalGroupsSyncedAt: timestamp("external_groups_synced_at", {
    withTimezone: true,
  }),
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
    // SHA-256 of the key: MetaMCP never stores API keys in clear text.
    key_hash: text("key_hash").notNull().unique(),
    // First and last characters, to recognise a key without revealing it.
    key_preview: text("key_preview").notNull(),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    is_active: boolean("is_active").notNull().default(true),
    scope: apiKeyScopeEnum("scope").notNull().default("user"),
  },
  (table) => [
    index("api_keys_user_id_idx").on(table.user_id),
    index("api_keys_is_active_idx").on(table.is_active),
    unique("api_keys_name_per_user_idx").on(table.user_id, table.name),
  ],
);

/** Endpoints an API key of scope "endpoints" is limited to. */
export const apiKeyEndpointsTable = pgTable(
  "api_key_endpoints",
  {
    api_key_uuid: uuid("api_key_uuid")
      .notNull()
      .references(() => apiKeysTable.uuid, { onDelete: "cascade" }),
    endpoint_uuid: uuid("endpoint_uuid")
      .notNull()
      .references(() => endpointsTable.uuid, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.api_key_uuid, table.endpoint_uuid] }),
    index("api_key_endpoints_endpoint_idx").on(table.endpoint_uuid),
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

// Data encryption keys (see lib/secrets), wrapped by a key encryption key
// that never touches the database (SECRETS_ENCRYPTION_KEY or OpenBao Transit).
// The most recent key whose activated_at has passed encrypts new values;
// older keys stay available for decryption until everything is re-encrypted.
export const encryptionKeysTable = pgTable("encryption_keys", {
  id: text("id").primaryKey(),
  wrapped_key: text("wrapped_key").notNull(),
  kek_provider: text("kek_provider").notNull(),
  kek_id: text("kek_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  activated_at: timestamp("activated_at", { withTimezone: true })
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

// ---------------------------------------------------------------------------
// RBAC: groups, memberships and resource shares
// ---------------------------------------------------------------------------

// User groups. A group can grant a role to its members, can be mapped to IdP
// groups (OIDC claim values, `*` wildcards allowed) and can receive shares.
// System groups (system_key = 'admins' | 'everyone') cannot be deleted;
// "everyone" implicitly contains every user and has no stored memberships.
export const groupsTable = pgTable(
  "groups",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    role: userRoleEnum("role"),
    system_key: text("system_key"),
    oidc_groups: text("oidc_groups")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("groups_name_lower_unique_idx").on(sql`lower(${table.name})`),
    unique("groups_system_key_unique").on(table.system_key),
    check(
      "groups_system_key_check",
      sql`${table.system_key} IS NULL OR ${table.system_key} IN ('admins', 'everyone')`,
    ),
  ],
);

export const groupMembersTable = pgTable(
  "group_members",
  {
    group_uuid: uuid("group_uuid")
      .notNull()
      .references(() => groupsTable.uuid, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // "oidc" memberships are managed by the SSO sync and removed when the IdP
    // stops sending the matching group; "manual" ones are never auto-removed.
    source: groupMembershipSourceEnum("source").notNull().default("manual"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.group_uuid, table.user_id] }),
    index("group_members_user_id_idx").on(table.user_id),
  ],
);

// A grant of `level` on one resource (MCP server or namespace) to one subject
// (user or group). Endpoints inherit the access of their namespace.
export const resourceSharesTable = pgTable(
  "resource_shares",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    mcp_server_uuid: uuid("mcp_server_uuid").references(
      () => mcpServersTable.uuid,
      { onDelete: "cascade" },
    ),
    namespace_uuid: uuid("namespace_uuid").references(
      () => namespacesTable.uuid,
      { onDelete: "cascade" },
    ),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    group_uuid: uuid("group_uuid").references(() => groupsTable.uuid, {
      onDelete: "cascade",
    }),
    level: shareLevelEnum("level").notNull().default("use"),
    created_by: text("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("resource_shares_mcp_server_uuid_idx").on(table.mcp_server_uuid),
    index("resource_shares_namespace_uuid_idx").on(table.namespace_uuid),
    index("resource_shares_user_id_idx").on(table.user_id),
    index("resource_shares_group_uuid_idx").on(table.group_uuid),
    uniqueIndex("resource_shares_server_user_unique_idx")
      .on(table.mcp_server_uuid, table.user_id)
      .where(
        sql`${table.mcp_server_uuid} IS NOT NULL AND ${table.user_id} IS NOT NULL`,
      ),
    uniqueIndex("resource_shares_server_group_unique_idx")
      .on(table.mcp_server_uuid, table.group_uuid)
      .where(
        sql`${table.mcp_server_uuid} IS NOT NULL AND ${table.group_uuid} IS NOT NULL`,
      ),
    uniqueIndex("resource_shares_namespace_user_unique_idx")
      .on(table.namespace_uuid, table.user_id)
      .where(
        sql`${table.namespace_uuid} IS NOT NULL AND ${table.user_id} IS NOT NULL`,
      ),
    uniqueIndex("resource_shares_namespace_group_unique_idx")
      .on(table.namespace_uuid, table.group_uuid)
      .where(
        sql`${table.namespace_uuid} IS NOT NULL AND ${table.group_uuid} IS NOT NULL`,
      ),
    check(
      "resource_shares_one_resource_check",
      sql`num_nonnulls(${table.mcp_server_uuid}, ${table.namespace_uuid}) = 1`,
    ),
    check(
      "resource_shares_one_subject_check",
      sql`num_nonnulls(${table.user_id}, ${table.group_uuid}) = 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Administrative activity log
// ---------------------------------------------------------------------------

// Who changed access, configuration or resources, plus security events.
// Append-only (a trigger rejects updates); old entries are removed by the
// retention job. Actor and target labels are snapshots so history survives
// deletions; no foreign keys on purpose. Never store secret values here.
export const activityLogsTable = pgTable(
  "activity_logs",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actor_type: activityActorTypeEnum("actor_type").notNull(),
    actor_id: text("actor_id"),
    actor_email: text("actor_email"),
    actor_name: text("actor_name"),
    action: text("action").notNull(),
    category: text("category").notNull(),
    target_type: text("target_type"),
    target_id: text("target_id"),
    target_label: text("target_label"),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    outcome: activityOutcomeEnum("outcome").notNull().default("success"),
    ip_address: text("ip_address"),
    user_agent: text("user_agent"),
  },
  (table) => [
    index("activity_logs_created_at_idx").on(table.created_at),
    index("activity_logs_actor_id_idx").on(table.actor_id, table.created_at),
    index("activity_logs_category_idx").on(table.category, table.created_at),
    index("activity_logs_target_id_idx").on(table.target_id),
  ],
);

// What an MCP server exposed the last time it was listed, to answer
// tools/list (and skip it in prompts/resources lists) without starting it.
// Never kept for servers that forward client headers (their answer may
// depend on the client's credentials).
export const mcpServerSnapshotsTable = pgTable("mcp_server_snapshots", {
  mcp_server_uuid: uuid("mcp_server_uuid")
    .primaryKey()
    .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
  server_info: jsonb("server_info").$type<Implementation>(),
  capabilities: jsonb("capabilities").$type<ServerCapabilities>().notNull(),
  // Tools as the server lists them (full definitions, names unprefixed)
  tools: jsonb("tools").$type<Tool[]>().notNull(),
  listed_at: timestamp("listed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
