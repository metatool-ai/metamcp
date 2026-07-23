import { z } from "zod";

// OAuth Client Information schema (a superset of the MCP SDK's
// OAuthClientInformationSchema). Uses `.passthrough()` so we round-trip the
// extra RFC 7591 metadata fields the pre-registered-client UI captures
// (redirect_uris, grant_types, response_types, scope,
// token_endpoint_auth_method, authorization_endpoint, token_endpoint).
// Without passthrough zod would silently strip those on read, causing the
// edit form to prefill blanks and overwrite the row on the next save.
export const OAuthClientInformationSchema = z
  .object({
    client_id: z.string(),
    client_secret: z.string().optional(),
    client_id_issued_at: z.number().optional(),
    client_secret_expires_at: z.number().optional(),
  })
  .passthrough();

// OAuth Tokens schema (matching MCP SDK)
export const OAuthTokensSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  refresh_token: z.string().optional(),
});

// Upstream token-response schema (RFC 6749 §5.1 plus common provider
// extensions). Used as the persisted shape in `oauth_sessions.tokens`
// because real-world responses include extra fields the MCP SDK's narrow
// schema would strip (Salesforce `instance_url`, OpenID Connect
// `id_token`, Microsoft `ext_expires_in`, ...). The repository's `tokens`
// parameter is typed against this so the bridge-cast sites can drop their
// `as unknown as OAuthTokens` casts.
export const UpstreamTokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number().optional(),
    refresh_token: z.string().optional(),
    scope: z.string().optional(),
    id_token: z.string().optional(),
  })
  .passthrough();

export type UpstreamTokenResponse = z.infer<typeof UpstreamTokenResponseSchema>;

// OAuth Client schema for registered clients
export const OAuthClientSchema = z.object({
  client_id: z.string(),
  client_secret: z.string().nullable(),
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
  scope: z.string().nullable(),
  client_uri: z.string().nullable(),
  logo_uri: z.string().nullable(),
  contacts: z.array(z.string()).nullable(),
  tos_uri: z.string().nullable(),
  policy_uri: z.string().nullable(),
  software_id: z.string().nullable(),
  software_version: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date().optional(),
});

// OAuth Authorization Code schema
export const OAuthAuthorizationCodeSchema = z.object({
  code: z.string(),
  client_id: z.string(),
  redirect_uri: z.string(),
  scope: z.string(),
  user_id: z.string(),
  code_challenge: z.string().nullable(),
  code_challenge_method: z.string().nullable(),
  expires_at: z.date(),
  created_at: z.date(),
});

// OAuth Access Token schema
export const OAuthAccessTokenSchema = z.object({
  access_token: z.string(),
  client_id: z.string(),
  user_id: z.string(),
  scope: z.string(),
  expires_at: z.date(),
  refresh_token: z.string().nullable(),
  refresh_token_expires_at: z.date().nullable(),
  created_at: z.date(),
});

// Input schemas for repositories
export const OAuthClientCreateInputSchema = z.object({
  client_id: z.string(),
  client_secret: z.string().nullable(),
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
  scope: z.string().nullable(),
  client_uri: z.string().nullable().optional(),
  logo_uri: z.string().nullable().optional(),
  contacts: z.array(z.string()).nullable().optional(),
  tos_uri: z.string().nullable().optional(),
  policy_uri: z.string().nullable().optional(),
  software_id: z.string().nullable().optional(),
  software_version: z.string().nullable().optional(),
  created_at: z.date(),
  updated_at: z.date().optional(),
});

export const OAuthAuthorizationCodeCreateInputSchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  scope: z.string(),
  user_id: z.string(),
  code_challenge: z.string().nullable().optional(),
  code_challenge_method: z.string().nullable().optional(),
  expires_at: z.number(), // timestamp
});

export const OAuthAccessTokenCreateInputSchema = z.object({
  client_id: z.string(),
  user_id: z.string(),
  scope: z.string(),
  expires_at: z.number(), // timestamp
});

// Base OAuth Session schema - client_information can be nullable since DB has default {}
export const OAuthSessionSchema = z.object({
  uuid: z.string().uuid(),
  mcp_server_uuid: z.string().uuid(),
  client_information: OAuthClientInformationSchema.nullable(),
  tokens: OAuthTokensSchema.nullable(),
  code_verifier: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// Get OAuth Session Request
export const GetOAuthSessionRequestSchema = z.object({
  mcp_server_uuid: z.string().uuid(),
});

// Get OAuth Session Response
export const GetOAuthSessionResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    data: OAuthSessionSchema,
    message: z.string(),
  }),
  z.object({
    success: z.literal(false),
    message: z.string(),
  }),
]);

// Upsert OAuth Session Request - all fields optional for updates.
// `tokens` and `code_verifier` are NOT nullable: the atomic upsert in
// `OAuthSessionsRepository.upsert` drops nullish values via the conditional
// spread (omit = "do not touch"), so allowing `null` here would advertise a
// "clear this column" contract the implementation does not honour.
// `expected_state` is the CSRF-defence per-flow nonce written by the
// frontend's `DbOAuthClientProvider.state()` and validated server-side at
// `exchangeToken`. Optional (omit = "do not touch"); clearing is a dedicated
// repo method, NOT a null write.
export const UpsertOAuthSessionRequestSchema = z.object({
  mcp_server_uuid: z.string().uuid(),
  client_information: OAuthClientInformationSchema.optional(),
  tokens: OAuthTokensSchema.optional(),
  code_verifier: z.string().optional(),
  expected_state: z.string().optional(),
});

// Upsert OAuth Session Response
export const UpsertOAuthSessionResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    data: OAuthSessionSchema,
    message: z.string(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Server-side token-exchange request: the frontend forwards the
// authorization code (received from the upstream's redirect) to MetaMCP's
// backend, which performs the POST to the upstream token endpoint. This
// replaces the browser-side `fetch(token_endpoint)` path that CORS-fails
// against most enterprise providers (Salesforce, Okta, Auth0, ...).
//
// Note: the upstream server URL is NOT accepted from the caller. The
// backend resolves it from the `mcp_servers` row keyed by mcp_server_uuid
// to prevent an authenticated user from steering discovery + token POST
// at an attacker-controlled host (SSRF / authorization-code exfiltration).
export const ExchangeOAuthTokenRequestSchema = z.object({
  mcp_server_uuid: z.string().uuid(),
  // Authorization code returned in the redirect query string.
  code: z.string().min(1, "code is required"),
  // Optional `state` parameter for CSRF defense. Echoed back from the
  // upstream redirect. Validated against an expected value when MetaMCP
  // gains per-flow state tracking (separate work).
  state: z.string().optional(),
});

// Upstream OAuth error envelope (RFC 6749 §5.2). Surfaced to the frontend
// so the callback page can render a real error instead of "Failed to fetch".
export const UpstreamOAuthErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  error_uri: z.string().optional(),
});

export const ExchangeOAuthTokenResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    message: z.string(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    error_description: z.string().optional(),
    // HTTP status code from the upstream, or 0 if MetaMCP could not reach it.
    upstream_status: z.number().optional(),
  }),
]);

// Server-side refresh-token grant. Same CORS rationale: the upstream's
// token endpoint typically rejects browser-origin requests. As with
// `ExchangeOAuthTokenRequestSchema`, the upstream URL is NOT accepted
// from the caller — it is resolved server-side from the mcp_servers row.
export const RefreshOAuthTokenRequestSchema = z.object({
  mcp_server_uuid: z.string().uuid(),
});

export const RefreshOAuthTokenResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    message: z.string(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    error_description: z.string().optional(),
    upstream_status: z.number().optional(),
  }),
]);

// Repository-specific schemas.
//
// `tokens` is typed against UpstreamTokenResponseSchema (RFC 6749 +
// .passthrough()) rather than the MCP SDK's narrow OAuthTokensSchema. The
// `oauth_sessions.tokens` jsonb column persists whatever the upstream
// returns (Salesforce `instance_url`, OIDC `id_token`, Microsoft
// `ext_expires_in`, ...); the wider type lets the backend write the
// response without `as unknown as OAuthTokens` casts.
export const OAuthSessionCreateInputSchema = z.object({
  mcp_server_uuid: z.string(),
  client_information: OAuthClientInformationSchema.optional(),
  tokens: UpstreamTokenResponseSchema.nullable().optional(),
  code_verifier: z.string().nullable().optional(),
  expected_state: z.string().optional(),
});

export const OAuthSessionUpdateInputSchema = z.object({
  mcp_server_uuid: z.string(),
  client_information: OAuthClientInformationSchema.optional(),
  tokens: UpstreamTokenResponseSchema.nullable().optional(),
  code_verifier: z.string().nullable().optional(),
  expected_state: z.string().optional(),
});

// Export repository types
export type OAuthSessionCreateInput = z.infer<
  typeof OAuthSessionCreateInputSchema
>;
export type OAuthSessionUpdateInput = z.infer<
  typeof OAuthSessionUpdateInputSchema
>;

// Database-specific schemas (raw database results with Date objects)
export const DatabaseOAuthSessionSchema = z.object({
  uuid: z.string(),
  mcp_server_uuid: z.string(),
  client_information: OAuthClientInformationSchema.nullable(),
  tokens: UpstreamTokenResponseSchema.nullable(),
  code_verifier: z.string().nullable(),
  // Per-flow CSRF nonce. Nullable on the DB read side: rows from before
  // this column was added, and rows where the exchange already cleared
  // the value, both carry NULL. NEVER serialized to the frontend.
  expected_state: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type DatabaseOAuthSession = z.infer<typeof DatabaseOAuthSessionSchema>;

// Export OAuth types
export type OAuthClient = z.infer<typeof OAuthClientSchema>;
export type OAuthClientCreateInput = z.infer<
  typeof OAuthClientCreateInputSchema
>;
export type OAuthAuthorizationCode = z.infer<
  typeof OAuthAuthorizationCodeSchema
>;
export type OAuthAuthorizationCodeCreateInput = z.infer<
  typeof OAuthAuthorizationCodeCreateInputSchema
>;
export type OAuthAccessToken = z.infer<typeof OAuthAccessTokenSchema>;
export type OAuthAccessTokenCreateInput = z.infer<
  typeof OAuthAccessTokenCreateInputSchema
>;
