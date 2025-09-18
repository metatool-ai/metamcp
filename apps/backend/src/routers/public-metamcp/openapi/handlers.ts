import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolResult,
  CompatibilityCallToolResultSchema,
  ListToolsResultSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { configService } from "../../../lib/config.service";
import { ConnectedClient } from "../../../lib/metamcp";
import { getMcpServers } from "../../../lib/metamcp/fetch-metamcp";
import { mcpServerPool } from "../../../lib/metamcp/mcp-server-pool";
import {
  createFilterCallToolMiddleware,
  createFilterListToolsMiddleware,
} from "../../../lib/metamcp/metamcp-middleware/filter-tools.functional";
import {
  CallToolHandler,
  compose,
  ListToolsHandler,
  MetaMCPHandlerContext,
} from "../../../lib/metamcp/metamcp-middleware/functional-middleware";
import { sanitizeName } from "../../../lib/metamcp/utils";

// Original List Tools Handler (adapted from metamcp-proxy.ts)
export const createOriginalListToolsHandler = (
  includeInactiveServers: boolean = false,
): ListToolsHandler => {
  return async (request, context) => {
    const serverParams = await getMcpServers(
      context.namespaceUuid,
      includeInactiveServers,
    );
    const allTools: Tool[] = [];

    await Promise.allSettled(
      Object.entries(serverParams).map(async ([mcpServerUuid, params]) => {
        const session = await mcpServerPool.getSession(
          context.sessionId,
          mcpServerUuid,
          params,
          context.namespaceUuid,
        );
        if (!session) return;

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.tools) return;

        // Use name assigned by user, fallback to name from server
        const serverName =
          params.name || session.client.getServerVersion()?.name || "";
        try {
          // Get configurable timeout values to bypass MCP SDK default enforcement
          const resetTimeoutOnProgress =
            await configService.getMcpResetTimeoutOnProgress();
          const timeout = await configService.getMcpTimeout();
          const maxTotalTimeout = await configService.getMcpMaxTotalTimeout();

          const mcpRequestOptions: RequestOptions = {
            resetTimeoutOnProgress,
            timeout,
            maxTotalTimeout,
          };

          const result = await session.client.request(
            {
              method: "tools/list",
              params: { _meta: request.params?._meta },
            },
            ListToolsResultSchema,
            mcpRequestOptions,
          );

          const toolsWithSource =
            result.tools?.map((tool) => {
              const toolName = `${sanitizeName(serverName)}__${tool.name}`;
              return {
                ...tool,
                name: toolName,
                description: tool.description,
              };
            }) || [];

          allTools.push(...toolsWithSource);
        } catch (error) {
          console.error(`Error fetching tools from: ${serverName}`, error);
        }
      }),
    );

    return { tools: allTools };
  };
};

// Original Call Tool Handler (adapted from metamcp-proxy.ts)
export const createOriginalCallToolHandler = (): CallToolHandler => {
  const toolToClient: Record<string, ConnectedClient> = {};
  const toolToServerUuid: Record<string, string> = {};

  return async (request, context) => {
    const { name, arguments: args } = request.params;

    // Extract the original tool name by removing the server prefix
    const firstDoubleUnderscoreIndex = name.indexOf("__");
    if (firstDoubleUnderscoreIndex === -1) {
      throw new Error(`Invalid tool name format: ${name}`);
    }

    const serverPrefix = name.substring(0, firstDoubleUnderscoreIndex);
    const originalToolName = name.substring(firstDoubleUnderscoreIndex + 2);

    // Get server parameters and find the right session for this tool
    const serverParams = await getMcpServers(context.namespaceUuid);
    let targetSession = null;

    for (const [mcpServerUuid, params] of Object.entries(serverParams)) {
      const session = await mcpServerPool.getSession(
        context.sessionId,
        mcpServerUuid,
        params,
        context.namespaceUuid,
      );
      if (!session) continue;

      const capabilities = session.client.getServerCapabilities();
      if (!capabilities?.tools) continue;

      // Use name assigned by user, fallback to name from server
      const serverName =
        params.name || session.client.getServerVersion()?.name || "";

      if (sanitizeName(serverName) === serverPrefix) {
        targetSession = session;
        toolToClient[name] = session;
        toolToServerUuid[name] = mcpServerUuid;
        break;
      }
    }

    if (!targetSession) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      // Get configurable timeout values to bypass MCP SDK default enforcement
      const resetTimeoutOnProgress =
        await configService.getMcpResetTimeoutOnProgress();
      const timeout = await configService.getMcpTimeout();
      const maxTotalTimeout = await configService.getMcpMaxTotalTimeout();

      const mcpRequestOptions: RequestOptions = {
        resetTimeoutOnProgress,
        timeout,
        maxTotalTimeout,
      };

      // Use the correct schema for tool calls with timeout options
      const result = await targetSession.client.request(
        {
          method: "tools/call",
          params: {
            name: originalToolName,
            arguments: args || {},
            _meta: {
              progressToken: request.params._meta?.progressToken,
            },
          },
        },
        CompatibilityCallToolResultSchema,
        mcpRequestOptions,
      );

      // Cast the result to CallToolResult type
      return result as CallToolResult;
    } catch (error) {
      console.error(
        `Error calling tool "${name}" through ${
          targetSession.client.getServerVersion()?.name || "unknown"
        }:`,
        error,
      );
      throw error;
    }
  };
};

// Helper function to create middleware-enabled handlers
export const createMiddlewareEnabledHandlers = (
  sessionId: string,
  namespaceUuid: string,
) => {
  // Create the handler context
  const handlerContext: MetaMCPHandlerContext = {
    namespaceUuid,
    sessionId,
  };

  // Create original handlers
  const originalListToolsHandler = createOriginalListToolsHandler();
  const originalCallToolHandler = createOriginalCallToolHandler();

  // Compose middleware with handlers
  const listToolsWithMiddleware = compose(
    createFilterListToolsMiddleware({ cacheEnabled: true }),
    // Add more middleware here as needed
    // createLoggingMiddleware(),
    // createRateLimitingMiddleware(),
  )(originalListToolsHandler);

  const callToolWithMiddleware = compose(
    createFilterCallToolMiddleware({
      cacheEnabled: true,
      customErrorMessage: (toolName, reason) =>
        `Access denied to tool "${toolName}": ${reason}`,
    }),
    // Add more middleware here as needed
    // createAuditingMiddleware(),
    // createAuthorizationMiddleware(),
  )(originalCallToolHandler);

  return {
    handlerContext,
    listToolsWithMiddleware,
    callToolWithMiddleware,
  };
};
