import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import {
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
import { createToolName } from "../metamcp/tool-name-parser";
import { zodToMcpInputSchema } from "./zod-to-mcp-schema";

export const METAMCP_ADMIN_SERVER_PREFIX = "metamcp-admin";

const emptySchema = z.object({});

export interface AdminToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  inputValidator: ZodTypeAny;
  handler: (userId: string, input: unknown) => Promise<unknown>;
}

function defineTool(
  name: string,
  description: string,
  inputValidator: ZodTypeAny,
  handler: (userId: string, input: unknown) => Promise<unknown>,
): AdminToolDefinition {
  return {
    name,
    description,
    inputSchema: zodToMcpInputSchema(inputValidator),
    inputValidator,
    handler,
  };
}

function definePublicTool(
  name: string,
  description: string,
  inputValidator: ZodTypeAny,
  handler: (input: unknown) => Promise<unknown>,
): AdminToolDefinition {
  return defineTool(name, description, inputValidator, async (_userId, input) =>
    handler(input),
  );
}

export const ADMIN_TOOLS: AdminToolDefinition[] = [
  // MCP Servers
  defineTool(
    "metamcp_list_mcp_servers",
    "List all MCP servers accessible to the authenticated user (public + owned).",
    emptySchema,
    async (userId) => mcpServersImplementations.list(userId),
  ),
  defineTool(
    "metamcp_get_mcp_server",
    "Get a single MCP server by UUID.",
    z.object({ uuid: z.string() }),
    async (userId, input) =>
      mcpServersImplementations.get(input as { uuid: string }, userId),
  ),
  defineTool(
    "metamcp_create_mcp_server",
    "Create a new upstream MCP server (STDIO, SSE, or STREAMABLE_HTTP).",
    CreateMcpServerRequestSchema,
    async (userId, input) =>
      mcpServersImplementations.create(
        CreateMcpServerRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_update_mcp_server",
    "Update an existing MCP server configuration.",
    UpdateMcpServerRequestSchema,
    async (userId, input) =>
      mcpServersImplementations.update(
        UpdateMcpServerRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_delete_mcp_server",
    "Delete an MCP server by UUID.",
    z.object({ uuid: z.string() }),
    async (userId, input) =>
      mcpServersImplementations.delete(input as { uuid: string }, userId),
  ),
  defineTool(
    "metamcp_bulk_import_mcp_servers",
    "Bulk import multiple MCP server configurations.",
    BulkImportMcpServersRequestSchema,
    async (userId, input) =>
      mcpServersImplementations.bulkImport(
        BulkImportMcpServersRequestSchema.parse(input),
        userId,
      ),
  ),

  // Namespaces
  defineTool(
    "metamcp_list_namespaces",
    "List all namespaces accessible to the authenticated user.",
    emptySchema,
    async (userId) => namespacesImplementations.list(userId),
  ),
  defineTool(
    "metamcp_get_namespace",
    "Get a namespace and its associated MCP servers by UUID.",
    z.object({ uuid: z.string() }),
    async (userId, input) =>
      namespacesImplementations.get(input as { uuid: string }, userId),
  ),
  defineTool(
    "metamcp_get_namespace_tools",
    "Get all tools in a namespace with status and overrides.",
    GetNamespaceToolsRequestSchema,
    async (userId, input) =>
      namespacesImplementations.getTools(
        GetNamespaceToolsRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_create_namespace",
    "Create a new namespace grouping MCP servers.",
    CreateNamespaceRequestSchema,
    async (userId, input) =>
      namespacesImplementations.create(
        CreateNamespaceRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_update_namespace",
    "Update a namespace name, description, or server membership.",
    UpdateNamespaceRequestSchema,
    async (userId, input) =>
      namespacesImplementations.update(
        UpdateNamespaceRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_delete_namespace",
    "Delete a namespace by UUID.",
    z.object({ uuid: z.string() }),
    async (userId, input) =>
      namespacesImplementations.delete(input as { uuid: string }, userId),
  ),
  defineTool(
    "metamcp_update_namespace_server_status",
    "Enable or disable an MCP server within a namespace.",
    UpdateNamespaceServerStatusRequestSchema,
    async (userId, input) =>
      namespacesImplementations.updateServerStatus(
        UpdateNamespaceServerStatusRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_update_namespace_tool_status",
    "Enable or disable a specific tool within a namespace.",
    UpdateNamespaceToolStatusRequestSchema,
    async (userId, input) =>
      namespacesImplementations.updateToolStatus(
        UpdateNamespaceToolStatusRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_update_namespace_tool_overrides",
    "Override tool name, title, description, or annotations in a namespace.",
    UpdateNamespaceToolOverridesRequestSchema,
    async (userId, input) =>
      namespacesImplementations.updateToolOverrides(
        UpdateNamespaceToolOverridesRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_refresh_namespace_tools",
    "Re-sync tools from live MCP connections for a namespace.",
    RefreshNamespaceToolsRequestSchema,
    async (userId, input) =>
      namespacesImplementations.refreshTools(
        RefreshNamespaceToolsRequestSchema.parse(input),
        userId,
      ),
  ),

  // Endpoints
  defineTool(
    "metamcp_list_endpoints",
    "List all public MetaMCP endpoints accessible to the user.",
    emptySchema,
    async (userId) => endpointsImplementations.list(userId),
  ),
  defineTool(
    "metamcp_get_endpoint",
    "Get a single endpoint by UUID.",
    z.object({ uuid: z.string() }),
    async (userId, input) =>
      endpointsImplementations.get(input as { uuid: string }, userId),
  ),
  defineTool(
    "metamcp_create_endpoint",
    "Create a new public endpoint exposing a namespace.",
    CreateEndpointRequestSchema,
    async (userId, input) =>
      endpointsImplementations.create(
        CreateEndpointRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_update_endpoint",
    "Update an existing endpoint configuration.",
    UpdateEndpointRequestSchema,
    async (userId, input) =>
      endpointsImplementations.update(
        UpdateEndpointRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_delete_endpoint",
    "Delete an endpoint by UUID.",
    z.object({ uuid: z.string() }),
    async (userId, input) =>
      endpointsImplementations.delete(input as { uuid: string }, userId),
  ),

  // API Keys
  defineTool(
    "metamcp_list_api_keys",
    "List API keys accessible to the authenticated user.",
    emptySchema,
    async (userId) => apiKeysImplementations.list(userId),
  ),
  defineTool(
    "metamcp_create_api_key",
    "Create a new API key for MetaMCP authentication.",
    CreateApiKeyRequestSchema,
    async (userId, input) =>
      apiKeysImplementations.create(
        CreateApiKeyRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_update_api_key",
    "Update an API key name or active status.",
    UpdateApiKeyRequestSchema,
    async (userId, input) =>
      apiKeysImplementations.update(
        UpdateApiKeyRequestSchema.parse(input),
        userId,
      ),
  ),
  defineTool(
    "metamcp_delete_api_key",
    "Delete an API key by UUID.",
    DeleteApiKeyRequestSchema,
    async (userId, input) =>
      apiKeysImplementations.delete(
        DeleteApiKeyRequestSchema.parse(input),
        userId,
      ),
  ),
  definePublicTool(
    "metamcp_validate_api_key",
    "Validate whether an API key is active and return its owner.",
    ValidateApiKeyRequestSchema,
    async (input) =>
      apiKeysImplementations.validate(ValidateApiKeyRequestSchema.parse(input)),
  ),

  // Config
  definePublicTool(
    "metamcp_get_signup_disabled",
    "Check whether new user registration is disabled.",
    emptySchema,
    async () => configImplementations.getSignupDisabled(),
  ),
  defineTool(
    "metamcp_set_signup_disabled",
    "Enable or disable new user registration.",
    z.object({ disabled: z.boolean() }),
    async (_userId, input) =>
      configImplementations.setSignupDisabled(
        z.object({ disabled: z.boolean() }).parse(input),
      ),
  ),
  definePublicTool(
    "metamcp_get_sso_signup_disabled",
    "Check whether SSO registration is disabled.",
    emptySchema,
    async () => configImplementations.getSsoSignupDisabled(),
  ),
  defineTool(
    "metamcp_set_sso_signup_disabled",
    "Enable or disable SSO registration.",
    z.object({ disabled: z.boolean() }),
    async (_userId, input) =>
      configImplementations.setSsoSignupDisabled(
        z.object({ disabled: z.boolean() }).parse(input),
      ),
  ),
  definePublicTool(
    "metamcp_get_basic_auth_disabled",
    "Check whether email/password authentication is disabled.",
    emptySchema,
    async () => configImplementations.getBasicAuthDisabled(),
  ),
  defineTool(
    "metamcp_set_basic_auth_disabled",
    "Enable or disable email/password authentication.",
    z.object({ disabled: z.boolean() }),
    async (_userId, input) =>
      configImplementations.setBasicAuthDisabled(
        z.object({ disabled: z.boolean() }).parse(input),
      ),
  ),
  definePublicTool(
    "metamcp_get_mcp_timeout",
    "Get the MCP request timeout in milliseconds.",
    emptySchema,
    async () => configImplementations.getMcpTimeout(),
  ),
  defineTool(
    "metamcp_set_mcp_timeout",
    "Set the MCP request timeout in milliseconds (1000-86400000).",
    z.object({ timeout: z.number().min(1000).max(86400000) }),
    async (_userId, input) =>
      configImplementations.setMcpTimeout(
        z.object({ timeout: z.number().min(1000).max(86400000) }).parse(input),
      ),
  ),
  definePublicTool(
    "metamcp_get_mcp_max_total_timeout",
    "Get the MCP max total timeout in milliseconds.",
    emptySchema,
    async () => configImplementations.getMcpMaxTotalTimeout(),
  ),
  defineTool(
    "metamcp_set_mcp_max_total_timeout",
    "Set the MCP max total timeout in milliseconds (1000-86400000).",
    z.object({ timeout: z.number().min(1000).max(86400000) }),
    async (_userId, input) =>
      configImplementations.setMcpMaxTotalTimeout(
        z.object({ timeout: z.number().min(1000).max(86400000) }).parse(input),
      ),
  ),
  definePublicTool(
    "metamcp_get_mcp_max_attempts",
    "Get the max crash attempts before marking a server as ERROR.",
    emptySchema,
    async () => configImplementations.getMcpMaxAttempts(),
  ),
  defineTool(
    "metamcp_set_mcp_max_attempts",
    "Set max crash attempts before ERROR state (1-10).",
    z.object({ maxAttempts: z.number().min(1).max(10) }),
    async (_userId, input) =>
      configImplementations.setMcpMaxAttempts(
        z.object({ maxAttempts: z.number().min(1).max(10) }).parse(input),
      ),
  ),
  definePublicTool(
    "metamcp_get_mcp_reset_timeout_on_progress",
    "Check whether MCP timeout resets on progress notifications.",
    emptySchema,
    async () => configImplementations.getMcpResetTimeoutOnProgress(),
  ),
  defineTool(
    "metamcp_set_mcp_reset_timeout_on_progress",
    "Enable or disable resetting MCP timeout on progress.",
    z.object({ enabled: z.boolean() }),
    async (_userId, input) =>
      configImplementations.setMcpResetTimeoutOnProgress(
        z.object({ enabled: z.boolean() }).parse(input),
      ),
  ),
  definePublicTool(
    "metamcp_get_session_lifetime",
    "Get the MCP session lifetime in milliseconds (null = default).",
    emptySchema,
    async () => configImplementations.getSessionLifetime(),
  ),
  defineTool(
    "metamcp_set_session_lifetime",
    "Set MCP session lifetime in ms (300000-86400000) or null for default.",
    z.object({
      lifetime: z.number().min(300000).max(86400000).nullable().optional(),
    }),
    async (_userId, input) =>
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
      ),
  ),
  defineTool(
    "metamcp_get_all_configs",
    "Get all raw configuration key-value pairs.",
    emptySchema,
    async () => configImplementations.getAllConfigs(),
  ),
  defineTool(
    "metamcp_set_config",
    "Set a raw configuration value by key.",
    SetConfigRequestSchema,
    async (_userId, input) =>
      configImplementations.setConfig(SetConfigRequestSchema.parse(input)),
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
    async (_userId, input) =>
      toolsImplementations.getByMcpServerUuid(
        GetToolsByMcpServerUuidRequestSchema.parse(input),
      ),
  ),
  defineTool(
    "metamcp_save_tools",
    "Upsert tools for an MCP server in the database.",
    CreateToolRequestSchema,
    async (_userId, input) =>
      toolsImplementations.create(CreateToolRequestSchema.parse(input)),
  ),
  defineTool(
    "metamcp_sync_tools",
    "Sync tools for an MCP server, removing obsolete entries.",
    CreateToolRequestSchema,
    async (_userId, input) =>
      toolsImplementations.sync(CreateToolRequestSchema.parse(input)),
  ),

  // OAuth sessions (upstream MCP servers)
  defineTool(
    "metamcp_get_oauth_session",
    "Get OAuth session tokens for an upstream OAuth-enabled MCP server.",
    GetOAuthSessionRequestSchema,
    async (_userId, input) =>
      oauthImplementations.get(GetOAuthSessionRequestSchema.parse(input)),
  ),
  defineTool(
    "metamcp_upsert_oauth_session",
    "Create or update OAuth session tokens for an upstream MCP server.",
    UpsertOAuthSessionRequestSchema,
    async (_userId, input) =>
      oauthImplementations.upsert(UpsertOAuthSessionRequestSchema.parse(input)),
  ),

  // Logs
  defineTool(
    "metamcp_get_logs",
    "Get recent MCP activity logs.",
    GetLogsRequestSchema,
    async (_userId, input) =>
      logsImplementations.getLogs(GetLogsRequestSchema.parse(input)),
  ),
  defineTool(
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

export function getAdminToolsForMcp(): Tool[] {
  return ADMIN_TOOLS.map((tool) => ({
    name: getExposedAdminToolName(tool.name),
    description: tool.description,
    inputSchema: tool.inputSchema as Tool["inputSchema"],
  }));
}

export async function executeAdminTool(
  exposedToolName: string,
  userId: string,
  rawArgs: unknown,
): Promise<CallToolResult> {
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

  try {
    const parsedInput = tool.inputValidator.parse(rawArgs ?? {});
    const result = await tool.handler(userId, parsedInput);

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
