import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  type AccessPrincipal,
  BulkImportMcpServersRequestSchema,
  CreateApiKeyRequestSchema,
  CreateEndpointRequestSchema,
  CreateMcpServerRequestSchema,
  CreateNamespaceRequestSchema,
  CreateToolRequestSchema,
  DeleteApiKeyRequestSchema,
  GetLogsRequestSchema,
  GetNamespaceToolsRequestSchema,
  GetOAuthSessionRequestSchema,
  GetToolsByMcpServerUuidRequestSchema,
  RefreshNamespaceToolsRequestSchema,
  SetConfigRequestSchema,
  UpdateApiKeyRequestSchema,
  UpdateEndpointRequestSchema,
  UpdateMcpServerRequestSchema,
  UpdateNamespaceRequestSchema,
  UpdateNamespaceServerStatusRequestSchema,
  UpdateNamespaceToolOverridesRequestSchema,
  UpdateNamespaceToolStatusRequestSchema,
  UpsertOAuthSessionRequestSchema,
  ValidateApiKeyRequestSchema,
} from "@repo/zod-types";
import type { ZodTypeAny } from "zod";
import { z } from "zod";

import { apiKeysImplementations } from "../../trpc/api-keys.impl";
import { configImplementations } from "../../trpc/config.impl";
import { endpointsImplementations } from "../../trpc/endpoints.impl";
import { logsImplementations } from "../../trpc/logs.impl";
import { mcpServersImplementations } from "../../trpc/mcp-servers.impl";
import { namespacesImplementations } from "../../trpc/namespaces.impl";
import { oauthImplementations } from "../../trpc/oauth.impl";
import { toolsImplementations } from "../../trpc/tools.impl";
import { accessService } from "../access/access.service";
import { createToolName } from "../metamcp/tool-name-parser";
import { zodToMcpInputSchema } from "./zod-to-mcp-schema";

export const METAMCP_ADMIN_SERVER_PREFIX = "metamcp-admin";

const emptySchema = z.object({});

export interface AdminToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  inputValidator: ZodTypeAny;
  /**
   * Instance-wide tools (settings, logs, key lookup) are only listed and
   * callable for administrators. Every other tool runs with the caller's own
   * permissions, exactly like the web UI.
   */
  adminOnly: boolean;
  handler: (principal: AccessPrincipal, input: unknown) => Promise<unknown>;
}

function defineTool(
  name: string,
  description: string,
  inputValidator: ZodTypeAny,
  handler: (principal: AccessPrincipal, input: unknown) => Promise<unknown>,
  options: { adminOnly?: boolean } = {},
): AdminToolDefinition {
  return {
    name,
    description,
    inputSchema: zodToMcpInputSchema(inputValidator),
    inputValidator,
    adminOnly: options.adminOnly ?? false,
    handler,
  };
}

function defineAdminOnlyTool(
  name: string,
  description: string,
  inputValidator: ZodTypeAny,
  handler: (principal: AccessPrincipal, input: unknown) => Promise<unknown>,
): AdminToolDefinition {
  return defineTool(name, description, inputValidator, handler, {
    adminOnly: true,
  });
}

function definePublicTool(
  name: string,
  description: string,
  inputValidator: ZodTypeAny,
  handler: (input: unknown) => Promise<unknown>,
): AdminToolDefinition {
  return defineTool(
    name,
    description,
    inputValidator,
    async (_principal, input) => handler(input),
  );
}

export const ADMIN_TOOLS: AdminToolDefinition[] = [
  // MCP Servers
  defineTool(
    "metamcp_list_mcp_servers",
    "List all MCP servers accessible to the authenticated user (public + owned).",
    emptySchema,
    async (principal) => mcpServersImplementations.list(principal),
  ),
  defineTool(
    "metamcp_get_mcp_server",
    "Get a single MCP server by UUID.",
    z.object({ uuid: z.string() }),
    async (principal, input) =>
      mcpServersImplementations.get(input as { uuid: string }, principal),
  ),
  defineTool(
    "metamcp_create_mcp_server",
    "Create a new upstream MCP server (STDIO, SSE, or STREAMABLE_HTTP).",
    CreateMcpServerRequestSchema,
    async (principal, input) =>
      mcpServersImplementations.create(
        CreateMcpServerRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_update_mcp_server",
    "Update an existing MCP server configuration.",
    UpdateMcpServerRequestSchema,
    async (principal, input) =>
      mcpServersImplementations.update(
        UpdateMcpServerRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_delete_mcp_server",
    "Delete an MCP server by UUID.",
    z.object({ uuid: z.string() }),
    async (principal, input) =>
      mcpServersImplementations.delete(input as { uuid: string }, principal),
  ),
  defineTool(
    "metamcp_bulk_import_mcp_servers",
    "Bulk import multiple MCP server configurations.",
    BulkImportMcpServersRequestSchema,
    async (principal, input) =>
      mcpServersImplementations.bulkImport(
        BulkImportMcpServersRequestSchema.parse(input),
        principal,
      ),
  ),

  // Namespaces
  defineTool(
    "metamcp_list_namespaces",
    "List all namespaces accessible to the authenticated user.",
    emptySchema,
    async (principal) => namespacesImplementations.list(principal),
  ),
  defineTool(
    "metamcp_get_namespace",
    "Get a namespace and its associated MCP servers by UUID.",
    z.object({ uuid: z.string() }),
    async (principal, input) =>
      namespacesImplementations.get(input as { uuid: string }, principal),
  ),
  defineTool(
    "metamcp_get_namespace_tools",
    "Get all tools in a namespace with status and overrides.",
    GetNamespaceToolsRequestSchema,
    async (principal, input) =>
      namespacesImplementations.getTools(
        GetNamespaceToolsRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_create_namespace",
    "Create a new namespace grouping MCP servers.",
    CreateNamespaceRequestSchema,
    async (principal, input) =>
      namespacesImplementations.create(
        CreateNamespaceRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_update_namespace",
    "Update a namespace name, description, or server membership.",
    UpdateNamespaceRequestSchema,
    async (principal, input) =>
      namespacesImplementations.update(
        UpdateNamespaceRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_delete_namespace",
    "Delete a namespace by UUID.",
    z.object({ uuid: z.string() }),
    async (principal, input) =>
      namespacesImplementations.delete(input as { uuid: string }, principal),
  ),
  defineTool(
    "metamcp_update_namespace_server_status",
    "Enable or disable an MCP server within a namespace.",
    UpdateNamespaceServerStatusRequestSchema,
    async (principal, input) =>
      namespacesImplementations.updateServerStatus(
        UpdateNamespaceServerStatusRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_update_namespace_tool_status",
    "Enable or disable a specific tool within a namespace.",
    UpdateNamespaceToolStatusRequestSchema,
    async (principal, input) =>
      namespacesImplementations.updateToolStatus(
        UpdateNamespaceToolStatusRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_update_namespace_tool_overrides",
    "Override tool name, title, description, or annotations in a namespace.",
    UpdateNamespaceToolOverridesRequestSchema,
    async (principal, input) =>
      namespacesImplementations.updateToolOverrides(
        UpdateNamespaceToolOverridesRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_refresh_namespace_tools",
    "Re-sync tools from live MCP connections for a namespace.",
    RefreshNamespaceToolsRequestSchema,
    async (principal, input) =>
      namespacesImplementations.refreshTools(
        RefreshNamespaceToolsRequestSchema.parse(input),
        principal,
      ),
  ),

  // Endpoints
  defineTool(
    "metamcp_list_endpoints",
    "List all public MetaMCP endpoints accessible to the user.",
    emptySchema,
    async (principal) => endpointsImplementations.list(principal),
  ),
  defineTool(
    "metamcp_get_endpoint",
    "Get a single endpoint by UUID.",
    z.object({ uuid: z.string() }),
    async (principal, input) =>
      endpointsImplementations.get(input as { uuid: string }, principal),
  ),
  defineTool(
    "metamcp_create_endpoint",
    "Create a new public endpoint exposing a namespace.",
    CreateEndpointRequestSchema,
    async (principal, input) =>
      endpointsImplementations.create(
        CreateEndpointRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_update_endpoint",
    "Update an existing endpoint configuration.",
    UpdateEndpointRequestSchema,
    async (principal, input) =>
      endpointsImplementations.update(
        UpdateEndpointRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_delete_endpoint",
    "Delete an endpoint by UUID.",
    z.object({ uuid: z.string() }),
    async (principal, input) =>
      endpointsImplementations.delete(input as { uuid: string }, principal),
  ),

  // API Keys
  defineTool(
    "metamcp_list_api_keys",
    "List API keys accessible to the authenticated user.",
    emptySchema,
    async (principal) => apiKeysImplementations.list(principal),
  ),
  defineTool(
    "metamcp_create_api_key",
    "Create a new API key for MetaMCP authentication.",
    CreateApiKeyRequestSchema,
    async (principal, input) =>
      apiKeysImplementations.create(
        CreateApiKeyRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_update_api_key",
    "Update an API key name or active status.",
    UpdateApiKeyRequestSchema,
    async (principal, input) =>
      apiKeysImplementations.update(
        UpdateApiKeyRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_delete_api_key",
    "Delete an API key by UUID.",
    DeleteApiKeyRequestSchema,
    async (principal, input) =>
      apiKeysImplementations.delete(
        DeleteApiKeyRequestSchema.parse(input),
        principal,
      ),
  ),
  defineAdminOnlyTool(
    "metamcp_validate_api_key",
    "Validate whether an API key is active and return its owner.",
    ValidateApiKeyRequestSchema,
    async (_principal, input) =>
      apiKeysImplementations.validate(ValidateApiKeyRequestSchema.parse(input)),
  ),

  // Config
  definePublicTool(
    "metamcp_get_signup_disabled",
    "Check whether new user registration is disabled.",
    emptySchema,
    async () => configImplementations.getSignupDisabled(),
  ),
  defineAdminOnlyTool(
    "metamcp_set_signup_disabled",
    "Enable or disable new user registration.",
    z.object({ disabled: z.boolean() }),
    async (principal, input) =>
      configImplementations.setSignupDisabled(
        z.object({ disabled: z.boolean() }).parse(input),
        principal,
      ),
  ),
  definePublicTool(
    "metamcp_get_sso_signup_disabled",
    "Check whether SSO registration is disabled.",
    emptySchema,
    async () => configImplementations.getSsoSignupDisabled(),
  ),
  defineAdminOnlyTool(
    "metamcp_set_sso_signup_disabled",
    "Enable or disable SSO registration.",
    z.object({ disabled: z.boolean() }),
    async (principal, input) =>
      configImplementations.setSsoSignupDisabled(
        z.object({ disabled: z.boolean() }).parse(input),
        principal,
      ),
  ),
  definePublicTool(
    "metamcp_get_basic_auth_disabled",
    "Check whether email/password authentication is disabled.",
    emptySchema,
    async () => configImplementations.getBasicAuthDisabled(),
  ),
  defineAdminOnlyTool(
    "metamcp_set_basic_auth_disabled",
    "Enable or disable email/password authentication.",
    z.object({ disabled: z.boolean() }),
    async (principal, input) =>
      configImplementations.setBasicAuthDisabled(
        z.object({ disabled: z.boolean() }).parse(input),
        principal,
      ),
  ),
  definePublicTool(
    "metamcp_get_mcp_timeout",
    "Get the MCP request timeout in milliseconds.",
    emptySchema,
    async () => configImplementations.getMcpTimeout(),
  ),
  defineAdminOnlyTool(
    "metamcp_set_mcp_timeout",
    "Set the MCP request timeout in milliseconds (1000-86400000).",
    z.object({ timeout: z.number().min(1000).max(86400000) }),
    async (principal, input) =>
      configImplementations.setMcpTimeout(
        z.object({ timeout: z.number().min(1000).max(86400000) }).parse(input),
        principal,
      ),
  ),
  definePublicTool(
    "metamcp_get_mcp_max_total_timeout",
    "Get the MCP max total timeout in milliseconds.",
    emptySchema,
    async () => configImplementations.getMcpMaxTotalTimeout(),
  ),
  defineAdminOnlyTool(
    "metamcp_set_mcp_max_total_timeout",
    "Set the MCP max total timeout in milliseconds (1000-86400000).",
    z.object({ timeout: z.number().min(1000).max(86400000) }),
    async (principal, input) =>
      configImplementations.setMcpMaxTotalTimeout(
        z.object({ timeout: z.number().min(1000).max(86400000) }).parse(input),
        principal,
      ),
  ),
  definePublicTool(
    "metamcp_get_mcp_max_attempts",
    "Get the max crash attempts before marking a server as ERROR.",
    emptySchema,
    async () => configImplementations.getMcpMaxAttempts(),
  ),
  defineAdminOnlyTool(
    "metamcp_set_mcp_max_attempts",
    "Set max crash attempts before ERROR state (1-10).",
    z.object({ maxAttempts: z.number().min(1).max(10) }),
    async (principal, input) =>
      configImplementations.setMcpMaxAttempts(
        z.object({ maxAttempts: z.number().min(1).max(10) }).parse(input),
        principal,
      ),
  ),
  definePublicTool(
    "metamcp_get_mcp_reset_timeout_on_progress",
    "Check whether MCP timeout resets on progress notifications.",
    emptySchema,
    async () => configImplementations.getMcpResetTimeoutOnProgress(),
  ),
  defineAdminOnlyTool(
    "metamcp_set_mcp_reset_timeout_on_progress",
    "Enable or disable resetting MCP timeout on progress.",
    z.object({ enabled: z.boolean() }),
    async (principal, input) =>
      configImplementations.setMcpResetTimeoutOnProgress(
        z.object({ enabled: z.boolean() }).parse(input),
        principal,
      ),
  ),
  definePublicTool(
    "metamcp_get_session_lifetime",
    "Get the MCP session lifetime in milliseconds (null = default).",
    emptySchema,
    async () => configImplementations.getSessionLifetime(),
  ),
  defineAdminOnlyTool(
    "metamcp_set_session_lifetime",
    "Set MCP session lifetime in ms (300000-86400000) or null for default.",
    z.object({
      lifetime: z.number().min(300000).max(86400000).nullable().optional(),
    }),
    async (principal, input) =>
      configImplementations.setSessionLifetime(
        z
          .object({
            lifetime: z
              .number()
              .min(300000)
              .max(86400000)
              .nullable()
              .optional(),
          })
          .parse(input),
        principal,
      ),
  ),
  defineAdminOnlyTool(
    "metamcp_get_all_configs",
    "Get all raw configuration key-value pairs.",
    emptySchema,
    async () => configImplementations.getAllConfigs(),
  ),
  defineAdminOnlyTool(
    "metamcp_set_config",
    "Set a raw configuration value by key.",
    SetConfigRequestSchema,
    async (principal, input) =>
      configImplementations.setConfig(
        SetConfigRequestSchema.parse(input),
        principal,
      ),
  ),
  definePublicTool(
    "metamcp_get_auth_providers",
    "List available authentication providers and their status.",
    emptySchema,
    async () => configImplementations.getAuthProviders(),
  ),

  // Tools
  defineTool(
    "metamcp_get_tools_by_mcp_server",
    "Get cached tools for an MCP server by UUID.",
    GetToolsByMcpServerUuidRequestSchema,
    async (principal, input) =>
      toolsImplementations.getByMcpServerUuid(
        GetToolsByMcpServerUuidRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_save_tools",
    "Upsert tools for an MCP server in the database.",
    CreateToolRequestSchema,
    async (principal, input) =>
      toolsImplementations.create(
        CreateToolRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_sync_tools",
    "Sync tools for an MCP server, removing obsolete entries.",
    CreateToolRequestSchema,
    async (principal, input) =>
      toolsImplementations.sync(
        CreateToolRequestSchema.parse(input),
        principal,
      ),
  ),

  // OAuth sessions (upstream MCP servers)
  defineTool(
    "metamcp_get_oauth_session",
    "Get OAuth session tokens for an upstream OAuth-enabled MCP server.",
    GetOAuthSessionRequestSchema,
    async (principal, input) =>
      oauthImplementations.get(
        GetOAuthSessionRequestSchema.parse(input),
        principal,
      ),
  ),
  defineTool(
    "metamcp_upsert_oauth_session",
    "Create or update OAuth session tokens for an upstream MCP server.",
    UpsertOAuthSessionRequestSchema,
    async (principal, input) =>
      oauthImplementations.upsert(
        UpsertOAuthSessionRequestSchema.parse(input),
        principal,
      ),
  ),

  // Logs
  defineAdminOnlyTool(
    "metamcp_get_logs",
    "Get recent MCP activity logs.",
    GetLogsRequestSchema,
    async (_principal, input) =>
      logsImplementations.getLogs(GetLogsRequestSchema.parse(input)),
  ),
  defineAdminOnlyTool(
    "metamcp_clear_logs",
    "Clear all MCP activity logs.",
    emptySchema,
    async () => logsImplementations.clearLogs(),
  ),
];

export const ADMIN_TOOLS_BY_NAME = new Map(
  ADMIN_TOOLS.map((tool) => [tool.name, tool]),
);

export function getExposedAdminToolName(toolName: string): string {
  return createToolName(METAMCP_ADMIN_SERVER_PREFIX, toolName);
}

export function isExposedAdminToolName(toolName: string): boolean {
  return toolName.startsWith(`${METAMCP_ADMIN_SERVER_PREFIX}__`);
}

/** Tools advertised to a principal (instance-wide tools only for admins). */
export function getAdminToolsForMcp(principal: AccessPrincipal): Tool[] {
  return ADMIN_TOOLS.filter((tool) => principal.isAdmin || !tool.adminOnly).map(
    (tool) => ({
      name: getExposedAdminToolName(tool.name),
      description: tool.description,
      inputSchema: tool.inputSchema as Tool["inputSchema"],
    }),
  );
}

function toolError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/**
 * Runs an admin tool as `userId`. The principal is resolved at every call so
 * a disabled user, a revoked role or a removed group takes effect on already
 * open MCP sessions.
 */
export async function executeAdminTool(
  exposedToolName: string,
  userId: string,
  rawArgs: unknown,
): Promise<CallToolResult> {
  const principal = await accessService.getPrincipal(userId);
  if (!principal) {
    return toolError(
      "Access denied: this account is disabled or no longer exists.",
    );
  }
  const parsedName = exposedToolName.startsWith(
    `${METAMCP_ADMIN_SERVER_PREFIX}__`,
  )
    ? exposedToolName.slice(METAMCP_ADMIN_SERVER_PREFIX.length + 2)
    : exposedToolName;

  const tool = ADMIN_TOOLS_BY_NAME.get(parsedName);

  if (!tool) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Unknown MetaMCP admin tool: ${exposedToolName}`,
          }),
        },
      ],
      isError: true,
    };
  }

  if (tool.adminOnly && !principal.isAdmin) {
    return toolError(
      `Access denied: ${exposedToolName} is reserved to MetaMCP administrators.`,
    );
  }

  try {
    const parsedInput = tool.inputValidator.parse(rawArgs ?? {});
    const result = await tool.handler(principal, parsedInput);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: message }),
        },
      ],
      isError: true,
    };
  }
}
