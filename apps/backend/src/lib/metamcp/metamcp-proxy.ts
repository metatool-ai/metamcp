import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
import { ConnectedClient } from "./client";
import { connectMetaMcpClient } from "./client";
import { getMcpServers } from "./fetch-metamcp";
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

export const createServer = async (
  namespaceUuid: string,
  sessionId: string,
  includeInactiveServers: boolean = false,
) => {
  const toolToClient: Record<string, ConnectedClient> = {};
  const toolToServerUuid: Record<string, string> = {};
  const promptToClient: Record<string, ConnectedClient> = {};
  const resourceToClient: Record<string, ConnectedClient> = {};

  const server = new Server(
    {
      name: "metamcp-unified",
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
    const serverParams = await getMcpServers(
      context.namespaceUuid,
      includeInactiveServers,
    );
    const allTools: Tool[] = [];

    await Promise.allSettled(
      Object.entries(serverParams).map(async ([mcpServerUuid, params]) => {
        const session = await connectMetaMcpClient(mcpServerUuid, params);
        if (!session) return;

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.tools) return;

        // Use name assigned by user, fallback to name from server
        const serverName =
          params.name || session.client.getServerVersion()?.name || "";
        try {
          const result = await session.client.request(
            {
              method: "tools/list",
              params: { _meta: request.params?._meta },
            },
            ListToolsResultSchema,
          );

          // Save original tools to database
          if (result.tools && result.tools.length > 0) {
            try {
              await toolsImplementations.create({
                tools: result.tools,
                mcpServerUuid: mcpServerUuid,
              });
              console.log(
                `Saved ${result.tools.length} tools for server: ${serverName}`,
              );
            } catch (dbError) {
              console.error(
                `Error saving tools to database for server ${serverName}:`,
                dbError,
              );
            }
          }

          const toolsWithSource =
            result.tools?.map((tool) => {
              const toolName = `${sanitizeName(serverName)}__${tool.name}`;
              toolToClient[toolName] = session;
              toolToServerUuid[toolName] = mcpServerUuid;
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

  // Original Call Tool Handler
  const originalCallToolHandler: CallToolHandler = async (
    request,
    _context,
  ) => {
    const { name, arguments: args } = request.params;

    // Extract the original tool name by removing the server prefix
    const firstDoubleUnderscoreIndex = name.indexOf("__");
    if (firstDoubleUnderscoreIndex === -1) {
      throw new Error(`Invalid tool name format: ${name}`);
    }

    const originalToolName = name.substring(firstDoubleUnderscoreIndex + 2);
    const clientForTool = toolToClient[name];
    const serverUuid = toolToServerUuid[name];

    if (!clientForTool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    if (!serverUuid) {
      throw new Error(`Server UUID not found for tool: ${name}`);
    }

    try {
      // Use the correct schema for tool calls
      const result = await clientForTool.client.request(
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
    createFilterListToolsMiddleware({ cacheEnabled: true }),
  )(originalListToolsHandler);

  const callToolWithMiddleware = compose(
    createFilterCallToolMiddleware({
      cacheEnabled: true,
      customErrorMessage: (toolName, reason) =>
        `Access denied to tool "${toolName}": ${reason}`,
    }),
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

    await Promise.allSettled(
      Object.entries(serverParams).map(async ([uuid, params]) => {
        const session = await connectMetaMcpClient(uuid, params);
        if (!session) return;

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

    await Promise.allSettled(
      Object.entries(serverParams).map(async ([uuid, params]) => {
        const session = await connectMetaMcpClient(uuid, params);
        if (!session) return;

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

      await Promise.allSettled(
        Object.entries(serverParams).map(async ([uuid, params]) => {
          const session = await connectMetaMcpClient(uuid, params);
          if (!session) return;

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
    // No need for session cleanup with Docker approach
    // Each connection is independent
    console.log("MetaMCP server cleanup - Docker connections are stateless");
  };

  return { server, cleanup };
};
