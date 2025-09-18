import { z } from "zod";

// OAuth Client Information schema (matching MCP SDK)
export const OAuthClientInformationSchema = z.object({
  client_id: z.string(),
  client_secret: z.string().optional(),
  client_id_issued_at: z.number().optional(),
  client_secret_expires_at: z.number().optional(),
});

// OAuth Tokens schema (matching MCP SDK)
export const OAuthTokensSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  refresh_token: z.string().optional(),
});

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

// Upsert OAuth Session Request - all fields optional for updates
export const UpsertOAuthSessionRequestSchema = z.object({
  mcp_server_uuid: z.string().uuid(),
  client_information: OAuthClientInformationSchema.optional(),
  tokens: OAuthTokensSchema.nullable().optional(),
  code_verifier: z.string().nullable().optional(),
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

// Repository-specific schemas
export const OAuthSessionCreateInputSchema = z.object({
  mcp_server_uuid: z.string(),
  client_information: OAuthClientInformationSchema.optional(),
  tokens: OAuthTokensSchema.nullable().optional(),
  code_verifier: z.string().nullable().optional(),
});

export const OAuthSessionUpdateInputSchema = z.object({
  mcp_server_uuid: z.string(),
  client_information: OAuthClientInformationSchema.optional(),
  tokens: OAuthTokensSchema.nullable().optional(),
  code_verifier: z.string().nullable().optional(),
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
  tokens: OAuthTokensSchema.nullable(),
  code_verifier: z.string().nullable(),
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
