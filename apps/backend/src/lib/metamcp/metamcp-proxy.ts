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
import { ConnectedClient } from "./client";
import { getMcpServers } from "./fetch-metamcp";
import { mcpServerPool } from "./mcp-server-pool";
import { toolsSyncCache } from "./tools-sync-cache";
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
import {
  createToolOverridesCallToolMiddleware,
  createToolOverridesListToolsMiddleware,
  mapOverrideNameToOriginal,
} from "./metamcp-middleware/tool-overrides.functional";
import { parseToolName } from "./tool-name-parser";
import { sanitizeName } from "./utils";

/**
 * Filter out tools that are overrides of existing tools to prevent duplicates in database
 * Uses the existing tool overrides cache for optimal performance
 */
async function filterOutOverrideTools(
  tools: Tool[],
  namespaceUuid: string,
  serverName: string,
): Promise<Tool[]> {
  if (!tools || tools.length === 0) {
    return tools;
  }

  const filteredTools: Tool[] = [];

  await Promise.allSettled(
    tools.map(async (tool) => {
      try {
        // Check if this tool name is actually an override name for an existing tool
        // by using the existing mapOverrideNameToOriginal function
        const fullToolName = `${sanitizeName(serverName)}__${tool.name}`;
        const originalName = await mapOverrideNameToOriginal(
          fullToolName,
          namespaceUuid,
          true, // use cache
        );

        // If the original name is different from the current name,
        // this tool is an override and should be filtered out
        if (originalName !== fullToolName) {
          // This is an override, skip it (don't save to database)
          return;
        }

        // This is not an override, include it
        filteredTools.push(tool);
      } catch (error) {
        console.error(
          `Error checking if tool ${tool.name} is an override:`,
          error,
        );
        // On error, include the tool (fail-safe behavior)
        filteredTools.push(tool);
      }
    }),
  );

  return filteredTools;
}

export const createServer = async (
  namespaceUuid: string,
  sessionId: string,
  includeInactiveServers: boolean = false,
) => {
  const toolToClient: Record<string, ConnectedClient> = {};
  const toolToServerUuid: Record<string, string> = {};
  const promptToClient: Record<string, ConnectedClient> = {};
  const resourceToClient: Record<string, ConnectedClient> = {};

  // Helper function to detect if a server is the same instance
  const isSameServerInstance = (
    params: { name?: string; url?: string | null },
    _serverUuid: string,
  ): boolean => {
    // Check if server name is exactly the same as our current server instance
    // This prevents exact recursive calls to the same server
    if (params.name === `metamcp-unified-${namespaceUuid}`) {
      return true;
    }

    return false;
  };

  const server = new Server(
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

  // Create the handler context
  const handlerContext: MetaMCPHandlerContext = {
    namespaceUuid,
    sessionId,
  };

  // Original List Tools Handler
  const originalListToolsHandler: ListToolsHandler = async (
    request,
    context,
  ) => {
    console.log("[DEBUG-TOOLS] 🔍 tools/list called for namespace:", namespaceUuid);
    const startTime = performance.now();
    const serverParams = await getMcpServers(
      context.namespaceUuid,
      includeInactiveServers,
    );
    const allTools: Tool[] = [];

    // Track visited servers to detect circular references - reset on each call
    const visitedServers = new Set<string>();

    // We'll filter servers during processing after getting sessions to check actual MCP server names
    const allServerEntries = Object.entries(serverParams);

    console.log(`[DEBUG-TOOLS] 📋 Processing ${allServerEntries.length} servers`);
    
    await Promise.allSettled(
      allServerEntries.map(async ([mcpServerUuid, params]) => {
        console.log(`[DEBUG-TOOLS] 🔧 Server: ${params.name || mcpServerUuid}`);
        
        // Skip if we've already visited this server to prevent circular references
        if (visitedServers.has(mcpServerUuid)) {
          console.log(`[DEBUG-TOOLS] ⏭️  Skipping already visited: ${params.name}`);
          return;
        }
        const session = await mcpServerPool.getSession(
          context.sessionId,
          mcpServerUuid,
          params,
          namespaceUuid,
        );
        if (!session) {
          console.log(`[DEBUG-TOOLS] ❌ No session for: ${params.name}`);
          return;
        }

        // Now check for self-referencing using the actual MCP server name
        const serverVersion = session.client.getServerVersion();
        const actualServerName = serverVersion?.name || params.name || "";
        const ourServerName = `metamcp-unified-${namespaceUuid}`;

        if (actualServerName === ourServerName) {
          console.log(
            `Skipping self-referencing MetaMCP server: "${actualServerName}"`,
          );
          return;
        }

        // Check basic self-reference patterns
        if (isSameServerInstance(params, mcpServerUuid)) {
          return;
        }

        // Mark this server as visited
        visitedServers.add(mcpServerUuid);

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.tools) return;

        // Use name assigned by user, fallback to name from server
        const serverName =
          params.name || session.client.getServerVersion()?.name || "";

        try {
          // Paginated tool discovery - load all pages automatically
          const allServerTools: Tool[] = [];
          let cursor: string | undefined = undefined;
          let hasMore = true;
          const toolFetchStart = performance.now();

          while (hasMore) {
            const result: z.infer<typeof ListToolsResultSchema> =
              await session.client.request(
                {
                  method: "tools/list",
                  params: {
                    cursor: cursor,
                    _meta: request.params?._meta,
                  },
                },
                ListToolsResultSchema,
              );

            if (result.tools && result.tools.length > 0) {
              allServerTools.push(...result.tools);
            }

            cursor = result.nextCursor;
            hasMore = !!result.nextCursor;
          }
          
          console.log(`[DEBUG-TOOLS] ⏱️  Fetched ${allServerTools.length} tools from ${serverName} in ${(performance.now() - toolFetchStart).toFixed(2)}ms`);

          // Save original tools to database (before middleware processing)
          // This ensures we only save the actual tool names, not override names
          // Filter out tools that are overrides of existing tools to prevent duplicates
          try {
            // PERFORMANCE OPTIMIZATION: Check hash FIRST to avoid expensive operations
            const toolNames = allServerTools.map((tool) => tool.name);
            const hasChanged = toolsSyncCache.hasChanged(mcpServerUuid, toolNames);
            
            console.log(`[DEBUG-TOOLS] 🔍 Hash check for ${serverName}: ${hasChanged ? 'CHANGED' : 'UNCHANGED'}`);

            if (hasChanged) {
              const toolsToSave = await filterOutOverrideTools(
                allServerTools,
                namespaceUuid,
                serverName,
              );

              if (toolsToSave.length > 0) {
                // Update cache
                toolsSyncCache.update(mcpServerUuid, toolNames);
                
                // Sync with cleanup
                await toolsImplementations.sync({
                  tools: toolsToSave,
                  mcpServerUuid: mcpServerUuid,
                });
              }
            }
          } catch (dbError) {
            console.error(
              `Error syncing tools to database for server ${serverName}:`,
              dbError,
            );
          }

          // Use original tools for client response (middleware will be applied later)
          const toolsWithSource = allServerTools.map((tool) => {
            const toolName = `${sanitizeName(serverName)}__${tool.name}`;
            toolToClient[toolName] = session;
            toolToServerUuid[toolName] = mcpServerUuid;

            return {
              ...tool,
              name: toolName,
              description: tool.description,
            };
          });

          allTools.push(...toolsWithSource);
        } catch (error) {
          console.error(`Error fetching tools from: ${serverName}`, error);
        }
      }),
    );

    const totalTime = performance.now() - startTime;
    console.log(`[DEBUG-TOOLS] ✅ tools/list completed in ${totalTime.toFixed(2)}ms, returning ${allTools.length} tools`);
    
    return { tools: allTools };
  };

  // Original Call Tool Handler
  const originalCallToolHandler: CallToolHandler = async (
    request,
    _context,
  ) => {
    const { name, arguments: args } = request.params;

    // Parse the tool name using shared utility
    const parsed = parseToolName(name);
    if (!parsed) {
      throw new Error(`Invalid tool name format: ${name}`);
    }

    const { serverName: serverPrefix, originalToolName } = parsed;

    // Try to find the tool in pre-populated mappings first
    let clientForTool = toolToClient[name];
    let serverUuid = toolToServerUuid[name];

    // If not found in mappings, dynamically find the server and route the call
    if (!clientForTool || !serverUuid) {
      try {
        // Get all MCP servers for this namespace
        const serverParams = await getMcpServers(
          namespaceUuid,
          includeInactiveServers,
        );

        // Find the server with the matching name prefix
        for (const [mcpServerUuid, params] of Object.entries(serverParams)) {
          const session = await mcpServerPool.getSession(
            sessionId,
            mcpServerUuid,
            params,
            namespaceUuid,
          );

          if (session) {
            const capabilities = session.client.getServerCapabilities();
            if (!capabilities?.tools) continue;

            // Use name assigned by user, fallback to name from server
            const serverName =
              params.name || session.client.getServerVersion()?.name || "";

            if (sanitizeName(serverName) === serverPrefix) {
              // Found the server, now check if it has this tool with pagination
              try {
                let foundTool = false;
                let cursor: string | undefined = undefined;
                let hasMore = true;

                while (hasMore && !foundTool) {
                  const result: z.infer<typeof ListToolsResultSchema> =
                    await session.client.request(
                      {
                        method: "tools/list",
                        params: { cursor: cursor },
                      },
                      ListToolsResultSchema,
                    );

                  if (
                    result.tools?.some(
                      (tool: Tool) => tool.name === originalToolName,
                    )
                  ) {
                    foundTool = true;
                    // Tool exists, populate mappings for future use and use it
                    clientForTool = session;
                    serverUuid = mcpServerUuid;
                    toolToClient[name] = session;
                    toolToServerUuid[name] = mcpServerUuid;
                    break;
                  }

                  cursor = result.nextCursor;
                  hasMore = !!result.nextCursor;
                }

                if (foundTool) {
                  break;
                }
              } catch (error) {
                console.error(
                  `Error checking tools for server ${serverName}:`,
                  error,
                );
                continue;
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error dynamically finding tool ${name}:`, error);
      }
    }

    if (!clientForTool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    if (!serverUuid) {
      throw new Error(`Server UUID not found for tool: ${name}`);
    }

    try {
      const abortController = new AbortController();

      // Get configurable timeout values
      const resetTimeoutOnProgress =
        await configService.getMcpResetTimeoutOnProgress();
      const timeout = await configService.getMcpTimeout();
      const maxTotalTimeout = await configService.getMcpMaxTotalTimeout();

      const mcpRequestOptions: RequestOptions = {
        signal: abortController.signal,
        resetTimeoutOnProgress,
        timeout,
        maxTotalTimeout,
      };
      // Use the correct schema for tool calls
      const result = await clientForTool.client.request(
        {
          method: "tools/call",
          params: {
            name: originalToolName,
            arguments: args || {},
            _meta: request.params._meta,
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
          clientForTool.client.getServerVersion()?.name || "unknown"
        }:`,
        error,
      );
      throw error;
    }
  };

  // Compose middleware with handlers - this is the Express-like functional approach
  const listToolsWithMiddleware = compose(
    createToolOverridesListToolsMiddleware({
      cacheEnabled: true,
      persistentCacheOnListTools: true,
    }),
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
    createToolOverridesCallToolMiddleware({ cacheEnabled: true }),
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
      // Parse the prompt name using shared utility
      const parsed = parseToolName(name);
      if (!parsed) {
        throw new Error(`Invalid prompt name format: ${name}`);
      }

      const promptName = parsed.originalToolName;
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
