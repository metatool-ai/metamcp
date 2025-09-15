import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  CallToolResult,
  CompatibilityCallToolResultSchema,
  GetPromptRequestSchema,
  GetPromptResultSchema,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  ResourceTemplate,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { toolsImplementations } from "../../trpc/tools.impl";
import { configService } from "../config.service";
import { AnyConnectedClient } from "./client";
import { listToolsFromClient, callToolOnClient, getServerInfo, clientSupportsCapability } from "./client-utils";
import { getMcpServers } from "./fetch-metamcp";
import { mcpServerPool } from "./mcp-server-pool";
import {
  createFilterCallToolMiddleware,
  createFilterListToolsMiddleware,
} from "./metamcp-middleware/filter-tools.functional";
import {
  CallToolHandler,
  compose,
  ListToolsHandler,
  MetaMCPHandlerContext,
} from "./metamcp-middleware/functional-middleware";
import { sanitizeName } from "./utils";

// Types for better organization
export interface ServerMappings {
  toolToClient: Record<string, AnyConnectedClient>;
  toolToServerUuid: Record<string, string>;
  promptToClient: Record<string, AnyConnectedClient>;
  resourceToClient: Record<string, AnyConnectedClient>;
}

export interface ServerCreationContext {
  namespaceUuid: string;
  sessionId: string;
  includeInactiveServers: boolean;
  mappings: ServerMappings;
}

// Helper functions for server creation
export const createServerMappings = (): ServerMappings => ({
  toolToClient: {},
  toolToServerUuid: {},
  promptToClient: {},
  resourceToClient: {},
});

export const isSameServerInstance = (
  params: { name?: string; url?: string | null },
  namespaceUuid: string,
  _serverUuid: string,
): boolean => {
  // Check if server name is exactly the same as our current server instance
  // This prevents exact recursive calls to the same server
  if (params.name === `metamcp-unified-${namespaceUuid}`) {
    return true;
  }
  return false;
};

export const createMcpServer = (namespaceUuid: string): Server => {
  return new Server(
    {
      name: `metamcp-unified-${namespaceUuid}`,
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
      },
    },
  );
};

export const createListToolsHandler = (
  context: ServerCreationContext
): ListToolsHandler => {
  return async (request, handlerContext) => {
    const serverParams = await getMcpServers(
      handlerContext.namespaceUuid,
      context.includeInactiveServers,
    );
    const allTools: Tool[] = [];

    // Track visited servers to detect circular references - reset on each call
    const visitedServers = new Set<string>();

    // We'll filter servers during processing after getting sessions to check actual MCP server names
    const allServerEntries = Object.entries(serverParams);

    await Promise.allSettled(
      allServerEntries.map(async ([mcpServerUuid, params]) => {
        // Skip if we've already visited this server to prevent circular references
        if (visitedServers.has(mcpServerUuid)) {
          return;
        }
        const session = await mcpServerPool.getSession(
          handlerContext.sessionId,
          mcpServerUuid,
          params,
          context.namespaceUuid,
        );
        if (!session) return;

        // Now check for self-referencing using the actual MCP server name
        const serverVersion = session.client?.getServerVersion?.();
        const actualServerName = serverVersion?.name || params.name || "";
        const ourServerName = `metamcp-unified-${context.namespaceUuid}`;

        if (actualServerName === ourServerName) {
          console.log(
            `Skipping self-referencing MetaMCP server: "${actualServerName}"`,
          );
          return;
        }

        // Mark this server as visited
        visitedServers.add(mcpServerUuid);

        try {
          const tools = await listToolsFromClient(session);
          if (tools && tools.length > 0) {
            for (const tool of tools) {
              const sanitizedName = sanitizeName(tool.name);
              context.mappings.toolToClient[sanitizedName] = session;
              context.mappings.toolToServerUuid[sanitizedName] = mcpServerUuid;
              allTools.push({
                ...tool,
                name: sanitizedName,
              });
            }
          }
        } catch (error) {
          console.error(
            `Error listing tools from server ${params.name}:`,
            error,
          );
        }
      }),
    );

    return { tools: allTools };
  };
};

export const createCallToolHandler = (
  context: ServerCreationContext
): CallToolHandler => {
  return async (request, _handlerContext) => {
    const { name, arguments: args } = request.params;

    // Extract the original tool name by removing the server prefix
    const firstDoubleUnderscoreIndex = name.indexOf("__");
    if (firstDoubleUnderscoreIndex === -1) {
      throw new Error(`Invalid tool name format: ${name}`);
    }

    const serverPrefix = name.substring(0, firstDoubleUnderscoreIndex);
    const originalToolName = name.substring(firstDoubleUnderscoreIndex + 2);

    // Try to find the tool in pre-populated mappings first
    let clientForTool = context.mappings.toolToClient[name];
    let serverUuid = context.mappings.toolToServerUuid[name];

    // If not found in mappings, dynamically find the server and route the call
    if (!clientForTool || !serverUuid) {
      try {
        // Get all MCP servers for this namespace
        const serverParams = await getMcpServers(
          context.namespaceUuid,
          context.includeInactiveServers,
        );

        // Find the server with the matching name prefix
        for (const [mcpServerUuid, params] of Object.entries(serverParams)) {
          const session = await mcpServerPool.getSession(
            context.sessionId,
            mcpServerUuid,
            params,
            context.namespaceUuid,
          );

          if (session) {
            const capabilities = session.client?.getServerCapabilities?.();
            if (!capabilities?.tools) continue;

            // Use name assigned by user, fallback to name from server
            const serverName =
              params.name || session.client?.getServerVersion?.()?.name || "";

            if (sanitizeName(serverName) === serverPrefix) {
              // Found the server, now check if it has this tool
              try {
                const result = await listToolsFromClient(session);

                if (
                  result.tools?.some((tool) => tool.name === originalToolName)
                ) {
                  // Tool exists, populate mappings for future use and use it
                  clientForTool = session;
                  serverUuid = mcpServerUuid;
                  context.mappings.toolToClient[name] = session;
                  context.mappings.toolToServerUuid[name] = mcpServerUuid;
                  break;
                }
              } catch (error) {
                console.error(`Error listing tools from server ${serverName}:`, error);
              }
            }
          }
        }
      } catch (error) {
        console.error("Error finding server for tool:", error);
        throw new Error(`Tool "${name}" not found or server unavailable`);
      }
    }

    if (!clientForTool) {
      throw new Error(`Tool "${name}" not found`);
    }

    try {
      const result = await callToolOnClient(clientForTool, originalToolName, args);
      return result;
    } catch (error) {
      console.error(`Error calling tool "${name}":`, error);
      throw error;
    }
  };
};

export const createServer = async (
  namespaceUuid: string,
  sessionId: string,
  includeInactiveServers: boolean = false,
) => {
  // Create server mappings and context
  const mappings = createServerMappings();
  const context: ServerCreationContext = {
    namespaceUuid,
    sessionId,
    includeInactiveServers,
    mappings,
  };

  // Create the MCP server instance
  const server = createMcpServer(namespaceUuid);

  // Create the handler context
  const handlerContext: MetaMCPHandlerContext = {
    namespaceUuid,
    sessionId,
  };

  // Create handlers using the extracted functions
  const originalListToolsHandler = createListToolsHandler(context);
  const originalCallToolHandler = createCallToolHandler(context);


  // Compose middleware with handlers - this is the Express-like functional approach
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

  // Set up the handlers with middleware
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return await listToolsWithMiddleware(request, handlerContext);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await callToolWithMiddleware(request, handlerContext);
  });

  // Get Prompt Handler
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;
    const clientForPrompt = promptToClient[name];

    if (!clientForPrompt) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    try {
      // Extract the original prompt name by removing the server prefix
      // For nested MetaMCP, names may be like "MetaMCPTest__Everything__promptName"
      // We need to extract "Everything__promptName" (everything after the first "__")
      const firstDoubleUnderscoreIndex = name.indexOf("__");
      if (firstDoubleUnderscoreIndex === -1) {
        throw new Error(`Invalid prompt name format: ${name}`);
      }

      const promptName = name.substring(firstDoubleUnderscoreIndex + 2);
      const response = await clientForPrompt.client.request(
        {
          method: "prompts/get",
          params: {
            name: promptName,
            arguments: request.params.arguments || {},
            _meta: request.params._meta,
          },
        },
        GetPromptResultSchema,
      );

      return response;
    } catch (error) {
      console.error(
        `Error getting prompt through ${
          clientForPrompt.client.getServerVersion()?.name
        }:`,
        error,
      );
      throw error;
    }
  });

  // List Prompts Handler
  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    const serverParams = await getMcpServers(
      namespaceUuid,
      includeInactiveServers,
    );
    const allPrompts: z.infer<typeof ListPromptsResultSchema>["prompts"] = [];

    // Track visited servers to detect circular references - reset on each call
    const visitedServers = new Set<string>();

    // Filter out self-referencing servers before processing
    const validPromptServers = Object.entries(serverParams).filter(
      ([uuid, params]) => {
        // Skip if we've already visited this server to prevent circular references
        if (visitedServers.has(uuid)) {
          console.log(
            `Skipping already visited server in prompts: ${params.name || uuid}`,
          );
          return false;
        }

        // Check if this server is the same instance to prevent self-referencing
        if (isSameServerInstance(params, uuid)) {
          console.log(
            `Skipping self-referencing server in prompts: ${params.name || uuid}`,
          );
          return false;
        }

        // Mark this server as visited
        visitedServers.add(uuid);
        return true;
      },
    );

    await Promise.allSettled(
      validPromptServers.map(async ([uuid, params]) => {
        const session = await mcpServerPool.getSession(
          sessionId,
          uuid,
          params,
          namespaceUuid,
        );
        if (!session) return;

        // Now check for self-referencing using the actual MCP server name
        const serverVersion = session.client.getServerVersion();
        const actualServerName = serverVersion?.name || params.name || "";
        const ourServerName = `metamcp-unified-${namespaceUuid}`;

        if (actualServerName === ourServerName) {
          console.log(
            `Skipping self-referencing MetaMCP server in prompts: "${actualServerName}"`,
          );
          return;
        }

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.prompts) return;

        // Use name assigned by user, fallback to name from server
        const serverName =
          params.name || session.client.getServerVersion()?.name || "";
        try {
          const result = await session.client.request(
            {
              method: "prompts/list",
              params: {
                cursor: request.params?.cursor,
                _meta: request.params?._meta,
              },
            },
            ListPromptsResultSchema,
          );

          if (result.prompts) {
            const promptsWithSource = result.prompts.map((prompt) => {
              const promptName = `${sanitizeName(serverName)}__${prompt.name}`;
              promptToClient[promptName] = session;
              return {
                ...prompt,
                name: promptName,
                description: prompt.description || "",
              };
            });
            allPrompts.push(...promptsWithSource);
          }
        } catch (error) {
          console.error(`Error fetching prompts from: ${serverName}`, error);
        }
      }),
    );

    return {
      prompts: allPrompts,
      nextCursor: request.params?.cursor,
    };
  });

  // List Resources Handler
  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const serverParams = await getMcpServers(
      namespaceUuid,
      includeInactiveServers,
    );
    const allResources: z.infer<typeof ListResourcesResultSchema>["resources"] =
      [];

    // Track visited servers to detect circular references - reset on each call
    const visitedServers = new Set<string>();

    // Filter out self-referencing servers before processing
    const validResourceServers = Object.entries(serverParams).filter(
      ([uuid, params]) => {
        // Skip if we've already visited this server to prevent circular references
        if (visitedServers.has(uuid)) {
          console.log(
            `Skipping already visited server in resources: ${params.name || uuid}`,
          );
          return false;
        }

        // Check if this server is the same instance to prevent self-referencing
        if (isSameServerInstance(params, uuid)) {
          console.log(
            `Skipping self-referencing server in resources: ${params.name || uuid}`,
          );
          return false;
        }

        // Mark this server as visited
        visitedServers.add(uuid);
        return true;
      },
    );

    await Promise.allSettled(
      validResourceServers.map(async ([uuid, params]) => {
        const session = await mcpServerPool.getSession(
          sessionId,
          uuid,
          params,
          namespaceUuid,
        );
        if (!session) return;

        // Now check for self-referencing using the actual MCP server name
        const serverVersion = session.client.getServerVersion();
        const actualServerName = serverVersion?.name || params.name || "";
        const ourServerName = `metamcp-unified-${namespaceUuid}`;

        if (actualServerName === ourServerName) {
          console.log(
            `Skipping self-referencing MetaMCP server in resources: "${actualServerName}"`,
          );
          return;
        }

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.resources) return;

        // Use name assigned by user, fallback to name from server
        const serverName =
          params.name || session.client.getServerVersion()?.name || "";
        try {
          const result = await session.client.request(
            {
              method: "resources/list",
              params: {
                cursor: request.params?.cursor,
                _meta: request.params?._meta,
              },
            },
            ListResourcesResultSchema,
          );

          if (result.resources) {
            const resourcesWithSource = result.resources.map((resource) => {
              resourceToClient[resource.uri] = session;
              return {
                ...resource,
                name: resource.name || "",
              };
            });
            allResources.push(...resourcesWithSource);
          }
        } catch (error) {
          console.error(`Error fetching resources from: ${serverName}`, error);
        }
      }),
    );

    return {
      resources: allResources,
      nextCursor: request.params?.cursor,
    };
  });

  // Read Resource Handler
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const clientForResource = resourceToClient[uri];

    if (!clientForResource) {
      throw new Error(`Unknown resource: ${uri}`);
    }

    try {
      return await clientForResource.client.request(
        {
          method: "resources/read",
          params: {
            uri,
            _meta: request.params._meta,
          },
        },
        ReadResourceResultSchema,
      );
    } catch (error) {
      console.error(
        `Error reading resource through ${
          clientForResource.client.getServerVersion()?.name
        }:`,
        error,
      );
      throw error;
    }
  });

  // List Resource Templates Handler
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (request) => {
      const serverParams = await getMcpServers(
        namespaceUuid,
        includeInactiveServers,
      );
      const allTemplates: ResourceTemplate[] = [];

      // Track visited servers to detect circular references - reset on each call
      const visitedServers = new Set<string>();

      // Filter out self-referencing servers before processing
      const validTemplateServers = Object.entries(serverParams).filter(
        ([uuid, params]) => {
          // Skip if we've already visited this server to prevent circular references
          if (visitedServers.has(uuid)) {
            console.log(
              `Skipping already visited server in resource templates: ${params.name || uuid}`,
            );
            return false;
          }

          // Check if this server is the same instance to prevent self-referencing
          if (isSameServerInstance(params, uuid)) {
            console.log(
              `Skipping self-referencing server in resource templates: ${params.name || uuid}`,
            );
            return false;
          }

          // Mark this server as visited
          visitedServers.add(uuid);
          return true;
        },
      );

      await Promise.allSettled(
        validTemplateServers.map(async ([uuid, params]) => {
          const session = await mcpServerPool.getSession(
            sessionId,
            uuid,
            params,
            namespaceUuid,
          );
          if (!session) return;

          // Now check for self-referencing using the actual MCP server name
          const serverVersion = session.client.getServerVersion();
          const actualServerName = serverVersion?.name || params.name || "";
          const ourServerName = `metamcp-unified-${namespaceUuid}`;

          if (actualServerName === ourServerName) {
            console.log(
              `Skipping self-referencing MetaMCP server in resource templates: "${actualServerName}"`,
            );
            return;
          }

          const capabilities = session.client.getServerCapabilities();
          if (!capabilities?.resources) return;

          const serverName =
            params.name || session.client.getServerVersion()?.name || "";

          try {
            const result = await session.client.request(
              {
                method: "resources/templates/list",
                params: {
                  cursor: request.params?.cursor,
                  _meta: request.params?._meta,
                },
              },
              ListResourceTemplatesResultSchema,
            );

            if (result.resourceTemplates) {
              const templatesWithSource = result.resourceTemplates.map(
                (template) => ({
                  ...template,
                  name: template.name || "",
                }),
              );
              allTemplates.push(...templatesWithSource);
            }
          } catch (error) {
            console.error(
              `Error fetching resource templates from: ${serverName}`,
              error,
            );
            return;
          }
        }),
      );

      return {
        resourceTemplates: allTemplates,
        nextCursor: request.params?.cursor,
      };
    },
  );

  const cleanup = async () => {
    // Cleanup is now handled by the pool
    await mcpServerPool.cleanupSession(sessionId);
  };

  return { server, cleanup };
};
