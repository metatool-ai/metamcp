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
  email: z.string().nullable(),
  user_id: z.string().nullable(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
  scope: z.string().nullable(),
  can_access_admin: z.boolean().default(false),
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
  email: z.string().nullable().optional(),
  user_id: z.string().nullable().optional(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
  scope: z.string().nullable(),
  can_access_admin: z.boolean().default(false),
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

// API response schemas
export const GetAllOAuthClientsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(
    OAuthClientSchema.extend({
      created_at: z.string().datetime(),
      updated_at: z.string().datetime().optional(),
    }),
  ),
  message: z.string().optional(),
});

export const UpdateOAuthClientAdminAccessRequestSchema = z.object({
  clientId: z.string(),
  canAccessAdmin: z.boolean(),
});

export const UpdateOAuthClientAdminAccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

export const DeleteOAuthClientRequestSchema = z.object({
  clientId: z.string(),
});

export const DeleteOAuthClientResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

export const GetOAuthClientsByUserIdRequestSchema = z.object({
  userId: z.string(),
});

export const GetOAuthClientsByUserIdResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(
    OAuthClientSchema.extend({
      created_at: z.string().datetime(),
      updated_at: z.string().datetime().optional(),
    }),
  ),
  message: z.string().optional(),
});

export type GetAllOAuthClientsResponse = z.infer<typeof GetAllOAuthClientsResponseSchema>;
export type UpdateOAuthClientAdminAccessRequest = z.infer<typeof UpdateOAuthClientAdminAccessRequestSchema>;
export type UpdateOAuthClientAdminAccessResponse = z.infer<typeof UpdateOAuthClientAdminAccessResponseSchema>;
export type DeleteOAuthClientRequest = z.infer<typeof DeleteOAuthClientRequestSchema>;
export type DeleteOAuthClientResponse = z.infer<typeof DeleteOAuthClientResponseSchema>;
export type GetOAuthClientsByUserIdRequest = z.infer<typeof GetOAuthClientsByUserIdRequestSchema>;
export type GetOAuthClientsByUserIdResponse = z.infer<typeof GetOAuthClientsByUserIdResponseSchema>;

// OAuth Request Logs schemas
export const OAuthRequestLogSchema = z.object({
  uuid: z.string().uuid(),
  client_id: z.string().nullable(),
  user_id: z.string().nullable(),
  request_type: z.string(), // 'authorization', 'token', 'refresh', 'userinfo', etc
  request_method: z.string(), // GET, POST, etc
  request_path: z.string(),
  request_query: z.record(z.string()).nullable(),
  request_headers: z.record(z.string()).nullable(),
  request_body: z.record(z.any()).nullable(),
  response_status: z.string(), // '200', '400', '401', etc
  response_body: z.record(z.any()).nullable(),
  error_message: z.string().nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  duration_ms: z.string().nullable(),
  created_at: z.date(),
});

export const OAuthRequestLogCreateInputSchema = z.object({
  client_id: z.string().nullable().optional(),
  user_id: z.string().nullable().optional(),
  request_type: z.string(),
  request_method: z.string(),
  request_path: z.string(),
  request_query: z.record(z.string()).nullable().optional(),
  request_headers: z.record(z.string()).nullable().optional(),
  request_body: z.record(z.any()).nullable().optional(),
  response_status: z.string(),
  response_body: z.record(z.any()).nullable().optional(),
  error_message: z.string().nullable().optional(),
  ip_address: z.string().nullable().optional(),
  user_agent: z.string().nullable().optional(),
  duration_ms: z.string().nullable().optional(),
});

export const DatabaseOAuthRequestLogSchema = OAuthRequestLogSchema;

export const GetOAuthRequestLogsRequestSchema = z.object({
  clientId: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
  offset: z.number().int().nonnegative().default(0),
});

export const GetOAuthRequestLogsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(
    OAuthRequestLogSchema.extend({
      created_at: z.string().datetime(),
    }),
  ),
  total: z.number(),
  message: z.string().optional(),
});

export type OAuthRequestLog = z.infer<typeof OAuthRequestLogSchema>;
export type OAuthRequestLogCreateInput = z.infer<typeof OAuthRequestLogCreateInputSchema>;
export type DatabaseOAuthRequestLog = z.infer<typeof DatabaseOAuthRequestLogSchema>;
export type GetOAuthRequestLogsRequest = z.infer<typeof GetOAuthRequestLogsRequestSchema>;
export type GetOAuthRequestLogsResponse = z.infer<typeof GetOAuthRequestLogsResponseSchema>;

// ============================================================
// MCP Request Logs Schemas
// ============================================================

export const McpRequestLogSchema = z.object({
  uuid: z.string().uuid(),
  clientId: z.string().nullable(),
  userId: z.string().nullable(),
  sessionId: z.string().nullable(),
  endpointName: z.string().nullable(),
  namespaceUuid: z.string().nullable(),
  requestType: z.string(),
  requestParams: z.record(z.any()).nullable(),
  responseResult: z.record(z.any()).nullable(),
  responseStatus: z.string(),
  errorMessage: z.string().nullable(),
  toolName: z.string().nullable(),
  durationMs: z.string().nullable(),
  createdAt: z.date(),
});

export const McpRequestLogCreateInputSchema = z.object({
  client_id: z.string().nullable(),
  user_id: z.string().nullable(),
  session_id: z.string().nullable(),
  endpoint_name: z.string().nullable(),
  namespace_uuid: z.string().nullable(),
  request_type: z.string(),
  request_params: z.record(z.any()).nullable(),
  response_result: z.record(z.any()).nullable(),
  response_status: z.string(),
  error_message: z.string().nullable(),
  tool_name: z.string().nullable(),
  duration_ms: z.string().nullable(),
});

export const DatabaseMcpRequestLogSchema = z.object({
  uuid: z.string().uuid(),
  client_id: z.string().nullable(),
  user_id: z.string().nullable(),
  session_id: z.string().nullable(),
  endpoint_name: z.string().nullable(),
  namespace_uuid: z.string().nullable(),
  request_type: z.string(),
  request_params: z.record(z.any()).nullable(),
  response_result: z.record(z.any()).nullable(),
  response_status: z.string(),
  error_message: z.string().nullable(),
  tool_name: z.string().nullable(),
  duration_ms: z.string().nullable(),
  created_at: z.date(),
});

export const GetMcpRequestLogsRequestSchema = z.object({
  clientId: z.string().optional(),
  sessionId: z.string().optional(),
  requestType: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
  offset: z.number().int().nonnegative().default(0),
});

export const GetMcpRequestLogsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(
    McpRequestLogSchema.extend({
      createdAt: z.string(),
    }),
  ),
  total: z.number(),
  message: z.string().optional(),
});

export type McpRequestLog = z.infer<typeof McpRequestLogSchema>;
export type McpRequestLogCreateInput = z.infer<typeof McpRequestLogCreateInputSchema>;
export type DatabaseMcpRequestLog = z.infer<typeof DatabaseMcpRequestLogSchema>;
export type GetMcpRequestLogsRequest = z.infer<typeof GetMcpRequestLogsRequestSchema>;
export type GetMcpRequestLogsResponse = z.infer<typeof GetMcpRequestLogsResponseSchema>;

// ============================================================
// MCP Server Call Logs Schemas (MetaMCP -> Real MCP Server calls)
// ============================================================

export const McpServerCallLogSchema = z.object({
  uuid: z.string().uuid(),
  clientId: z.string().nullable(),
  userId: z.string().nullable(),
  sessionId: z.string().nullable(),
  endpointName: z.string().nullable(),
  namespaceUuid: z.string().nullable(),
  mcpServerUuid: z.string().nullable(),
  mcpServerName: z.string().nullable(),
  toolName: z.string(),
  toolArguments: z.record(z.any()).nullable(),
  result: z.record(z.any()).nullable(),
  status: z.string(),
  errorMessage: z.string().nullable(),
  durationMs: z.string().nullable(),
  createdAt: z.date(),
});

export const McpServerCallLogCreateInputSchema = z.object({
  client_id: z.string().nullable(),
  user_id: z.string().nullable(),
  session_id: z.string().nullable(),
  endpoint_name: z.string().nullable(),
  namespace_uuid: z.string().nullable(),
  mcp_server_uuid: z.string().nullable(),
  mcp_server_name: z.string().nullable(),
  tool_name: z.string(),
  tool_arguments: z.record(z.any()).nullable(),
  result: z.record(z.any()).nullable(),
  status: z.string(),
  error_message: z.string().nullable(),
  duration_ms: z.string().nullable(),
});

export const DatabaseMcpServerCallLogSchema = z.object({
  uuid: z.string().uuid(),
  client_id: z.string().nullable(),
  user_id: z.string().nullable(),
  session_id: z.string().nullable(),
  endpoint_name: z.string().nullable(),
  namespace_uuid: z.string().nullable(),
  mcp_server_uuid: z.string().nullable(),
  mcp_server_name: z.string().nullable(),
  tool_name: z.string(),
  tool_arguments: z.record(z.any()).nullable(),
  result: z.record(z.any()).nullable(),
  status: z.string(),
  error_message: z.string().nullable(),
  duration_ms: z.string().nullable(),
  created_at: z.date(),
});

export const GetMcpServerCallLogsRequestSchema = z.object({
  clientId: z.string().optional(),
  sessionId: z.string().optional(),
  mcpServerUuid: z.string().optional(),
  toolName: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
  offset: z.number().int().nonnegative().default(0),
});

export const GetMcpServerCallLogsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(
    DatabaseMcpServerCallLogSchema.extend({
      createdAt: z.string(),
    }),
  ),
  total: z.number(),
  message: z.string().optional(),
});

export type McpServerCallLog = z.infer<typeof McpServerCallLogSchema>;
export type McpServerCallLogCreateInput = z.infer<typeof McpServerCallLogCreateInputSchema>;
export type DatabaseMcpServerCallLog = z.infer<typeof DatabaseMcpServerCallLogSchema>;
export type GetMcpServerCallLogsRequest = z.infer<typeof GetMcpServerCallLogsRequestSchema>;
export type GetMcpServerCallLogsResponse = z.infer<typeof GetMcpServerCallLogsResponseSchema>;
