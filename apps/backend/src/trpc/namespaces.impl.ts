import {
  CreateNamespaceRequestSchema,
  CreateNamespaceResponseSchema,
  DeleteNamespaceResponseSchema,
  GetNamespaceResponseSchema,
  GetNamespaceToolsRequestSchema,
  GetNamespaceToolsResponseSchema,
  ListNamespacesResponseSchema,
  RefreshNamespaceToolsRequestSchema,
  RefreshNamespaceToolsResponseSchema,
  UpdateNamespaceRequestSchema,
  UpdateNamespaceResponseSchema,
  UpdateNamespaceServerStatusRequestSchema,
  UpdateNamespaceServerStatusResponseSchema,
  UpdateNamespaceToolStatusRequestSchema,
  UpdateNamespaceToolStatusResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import {
  mcpServersRepository,
  namespaceMappingsRepository,
  namespacesRepository,
  toolsRepository,
} from "../db/repositories";
import { NamespacesSerializer } from "../db/serializers";
import { metaMcpServerPool } from "../lib/metamcp/metamcp-server-pool";

export const namespacesImplementations = {
  create: async (
    input: z.infer<typeof CreateNamespaceRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof CreateNamespaceResponseSchema>> => {
    try {
      // Determine user ownership based on input.user_id or default to current user
      const effectiveUserId =
        input.user_id !== undefined ? input.user_id : userId;
      const isPublicNamespace = effectiveUserId === null;

      // Validate server accessibility and relationship rules
      if (input.mcpServerUuids && input.mcpServerUuids.length > 0) {
        // Get detailed server information to validate access and ownership
        const serverPromises = input.mcpServerUuids.map((uuid) =>
          mcpServersRepository.findByUuid(uuid),
        );
        const servers = await Promise.all(serverPromises);

        // Check if any servers don't exist
        const missingServers = servers.some((server) => !server);
        if (missingServers) {
          return {
            success: false as const,
            message: "One or more selected MCP servers could not be found",
          };
        }

        // Validate access and relationship rules
        for (const server of servers) {
          if (!server) continue;

          // Check if user has access to this server (own server or public server)
          if (server.user_id && server.user_id !== userId) {
            return {
              success: false as const,
              message: `Access denied: You don't have permission to use server "${server.name}"`,
            };
          }

          // Enforce relationship rules: public namespaces can only contain public servers
          if (isPublicNamespace && server.user_id !== null) {
            return {
              success: false as const,
              message: `Access denied: Public namespaces can only contain public MCP servers. Server "${server.name}" is private`,
            };
          }
        }
      }

      const result = await namespacesRepository.create({
        name: input.name,
        description: input.description,
        mcpServerUuids: input.mcpServerUuids,
        user_id: effectiveUserId,
      });

      // Ensure idle MetaMCP server exists for the new namespace to improve performance
      // Run this asynchronously to avoid blocking the response
      metaMcpServerPool
        .ensureIdleServerForNewNamespace(result.uuid)
        .then(() => {
          console.log(
            `Ensured idle MetaMCP server exists for new namespace ${result.uuid}`,
          );
        })
        .catch((error) => {
          console.error(
            `Error ensuring idle MetaMCP server for new namespace ${result.uuid}:`,
            error,
          );
          // Don't fail the entire create operation if idle server creation fails
        });

      return {
        success: true as const,
        data: NamespacesSerializer.serializeNamespace(result),
        message: "Namespace created successfully",
      };
    } catch (error) {
      console.error("Error creating namespace:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  list: async (
    userId: string,
  ): Promise<z.infer<typeof ListNamespacesResponseSchema>> => {
    try {
      // Find namespaces accessible to user (public + user's own)
      const namespaces =
        await namespacesRepository.findAllAccessibleToUser(userId);

      return {
        success: true as const,
        data: NamespacesSerializer.serializeNamespaceList(namespaces),
        message: "Namespaces retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching namespaces:", error);
      return {
        success: false as const,
        data: [],
        message: "Failed to fetch namespaces",
      };
    }
  },

  get: async (
    input: {
      uuid: string;
    },
    userId: string,
  ): Promise<z.infer<typeof GetNamespaceResponseSchema>> => {
    try {
      const namespaceWithServers =
        await namespacesRepository.findByUuidWithServers(input.uuid);

      if (!namespaceWithServers) {
        return {
          success: false as const,
          message: "Namespace not found",
        };
      }

      // Check if user has access to this namespace (own namespace or public namespace)
      if (
        namespaceWithServers.user_id &&
        namespaceWithServers.user_id !== userId
      ) {
        return {
          success: false as const,
          message:
            "Access denied: You can only view namespaces you own or public namespaces",
        };
      }

      return {
        success: true as const,
        data: NamespacesSerializer.serializeNamespaceWithServers(
          namespaceWithServers,
        ),
        message: "Namespace retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching namespace:", error);
      return {
        success: false as const,
        message: "Failed to fetch namespace",
      };
    }
  },

  getTools: async (
    input: z.infer<typeof GetNamespaceToolsRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof GetNamespaceToolsResponseSchema>> => {
    try {
      // First, check if user has access to this namespace
      const namespace = await namespacesRepository.findByUuid(
        input.namespaceUuid,
      );

      if (!namespace) {
        return {
          success: false as const,
          data: [],
          message: "Namespace not found",
        };
      }

      // Check if user has access to this namespace (own namespace or public namespace)
      if (namespace.user_id && namespace.user_id !== userId) {
        return {
          success: false as const,
          data: [],
          message:
            "Access denied: You can only view tools for namespaces you own or public namespaces",
        };
      }

      const toolsData = await namespacesRepository.findToolsByNamespaceUuid(
        input.namespaceUuid,
      );

      return {
        success: true as const,
        data: NamespacesSerializer.serializeNamespaceTools(toolsData),
        message: "Namespace tools retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching namespace tools:", error);
      return {
        success: false as const,
        data: [],
        message: "Failed to fetch namespace tools",
      };
    }
  },

  delete: async (
    input: {
      uuid: string;
    },
    userId: string,
  ): Promise<z.infer<typeof DeleteNamespaceResponseSchema>> => {
    try {
      // First, check if the namespace exists and user has permission to delete it
      const existingNamespace = await namespacesRepository.findByUuid(
        input.uuid,
      );

      if (!existingNamespace) {
        return {
          success: false as const,
          message: "Namespace not found",
        };
      }

      // Check if user owns this namespace (only owners can delete, protect public namespaces)
      if (existingNamespace.user_id && existingNamespace.user_id !== userId) {
        return {
          success: false as const,
          message: "Access denied: You can only delete namespaces you own",
        };
      }

      const deletedNamespace = await namespacesRepository.deleteByUuid(
        input.uuid,
      );

      if (!deletedNamespace) {
        return {
          success: false as const,
          message: "Namespace not found",
        };
      }

      // Clean up idle MetaMCP server for the deleted namespace
      try {
        await metaMcpServerPool.cleanupIdleServer(input.uuid);
        console.log(
          `Cleaned up idle MetaMCP server for deleted namespace ${input.uuid}`,
        );
      } catch (error) {
        console.error(
          `Error cleaning up idle MetaMCP server for deleted namespace ${input.uuid}:`,
          error,
        );
        // Don't fail the entire delete operation if idle server cleanup fails
      }

      return {
        success: true as const,
        message: "Namespace deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting namespace:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  update: async (
    input: z.infer<typeof UpdateNamespaceRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof UpdateNamespaceResponseSchema>> => {
    try {
      // First, check if the namespace exists and user has permission to update it
      const existingNamespace = await namespacesRepository.findByUuid(
        input.uuid,
      );

      if (!existingNamespace) {
        return {
          success: false as const,
          message: "Namespace not found",
        };
      }

      // Check if user owns this namespace (only owners can update)
      if (existingNamespace.user_id && existingNamespace.user_id !== userId) {
        return {
          success: false as const,
          message: "Access denied: You can only update namespaces you own",
        };
      }

      // Determine the effective ownership for validation (use input.user_id if provided, otherwise existing)
      const effectiveUserId =
        input.user_id !== undefined ? input.user_id : existingNamespace.user_id;
      const isPublicNamespace = effectiveUserId === null;

      // Validate server accessibility and relationship rules if servers are being updated
      if (input.mcpServerUuids && input.mcpServerUuids.length > 0) {
        // Get detailed server information to validate access and ownership
        const serverPromises = input.mcpServerUuids.map((uuid) =>
          mcpServersRepository.findByUuid(uuid),
        );
        const servers = await Promise.all(serverPromises);

        // Check if any servers don't exist
        const missingServers = servers.some((server) => !server);
        if (missingServers) {
          return {
            success: false as const,
            message: "One or more selected MCP servers could not be found",
          };
        }

        // Validate access and relationship rules
        for (const server of servers) {
          if (!server) continue;

          // Check if user has access to this server (own server or public server)
          if (server.user_id && server.user_id !== userId) {
            return {
              success: false as const,
              message: `Access denied: You don't have permission to use server "${server.name}"`,
            };
          }

          // Enforce relationship rules: public namespaces can only contain public servers
          if (isPublicNamespace && server.user_id !== null) {
            return {
              success: false as const,
              message: `Access denied: Public namespaces can only contain public MCP servers. Server "${server.name}" is private`,
            };
          }
        }
      }

      const result = await namespacesRepository.update({
        uuid: input.uuid,
        name: input.name,
        description: input.description,
        user_id: input.user_id,
        mcpServerUuids: input.mcpServerUuids,
      });

      // Invalidate idle MetaMCP server for this namespace since the MCP servers list may have changed
      // Run this asynchronously to avoid blocking the response
      metaMcpServerPool
        .invalidateIdleServer(input.uuid)
        .then(() => {
          console.log(
            `Invalidated idle MetaMCP server for updated namespace ${input.uuid}`,
          );
        })
        .catch((error) => {
          console.error(
            `Error invalidating idle MetaMCP server for namespace ${input.uuid}:`,
            error,
          );
          // Don't fail the entire update operation if idle server invalidation fails
        });

      // Also invalidate OpenAPI sessions for this namespace
      metaMcpServerPool
        .invalidateOpenApiSessions([input.uuid])
        .then(() => {
          console.log(
            `Invalidated OpenAPI session for updated namespace ${input.uuid}`,
          );
        })
        .catch((error) => {
          console.error(
            `Error invalidating OpenAPI session for namespace ${input.uuid}:`,
            error,
          );
          // Don't fail the entire update operation if OpenAPI session invalidation fails
        });

      return {
        success: true as const,
        data: NamespacesSerializer.serializeNamespace(result),
        message: "Namespace updated successfully",
      };
    } catch (error) {
      console.error("Error updating namespace:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  updateServerStatus: async (
    input: z.infer<typeof UpdateNamespaceServerStatusRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof UpdateNamespaceServerStatusResponseSchema>> => {
    try {
      // First, check if user has permission to update this namespace
      const namespace = await namespacesRepository.findByUuid(
        input.namespaceUuid,
      );

      if (!namespace) {
        return {
          success: false as const,
          message: "Namespace not found",
        };
      }

      // Check if user owns this namespace (only owners can update server status)
      if (namespace.user_id && namespace.user_id !== userId) {
        return {
          success: false as const,
          message:
            "Access denied: You can only update server status for namespaces you own",
        };
      }

      const updatedMapping =
        await namespaceMappingsRepository.updateServerStatus({
          namespaceUuid: input.namespaceUuid,
          serverUuid: input.serverUuid,
          status: input.status,
        });

      if (!updatedMapping) {
        return {
          success: false as const,
          message: "Server not found in namespace",
        };
      }

      // Invalidate idle MetaMCP server for this namespace since server status changed
      // Run this asynchronously to avoid blocking the response
      metaMcpServerPool
        .invalidateIdleServer(input.namespaceUuid)
        .then(() => {
          console.log(
            `Invalidated idle MetaMCP server for namespace ${input.namespaceUuid} after server status update`,
          );
        })
        .catch((error) => {
          console.error(
            `Error invalidating idle MetaMCP server for namespace ${input.namespaceUuid}:`,
            error,
          );
          // Don't fail the entire operation if idle server invalidation fails
        });

      // Also invalidate OpenAPI sessions for this namespace
      metaMcpServerPool
        .invalidateOpenApiSessions([input.namespaceUuid])
        .then(() => {
          console.log(
            `Invalidated OpenAPI session for namespace ${input.namespaceUuid} after server status update`,
          );
        })
        .catch((error) => {
          console.error(
            `Error invalidating OpenAPI session for namespace ${input.namespaceUuid}:`,
            error,
          );
          // Don't fail the entire operation if OpenAPI session invalidation fails
        });

      return {
        success: true as const,
        message: "Server status updated successfully",
      };
    } catch (error) {
      console.error("Error updating server status:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  updateToolStatus: async (
    input: z.infer<typeof UpdateNamespaceToolStatusRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof UpdateNamespaceToolStatusResponseSchema>> => {
    try {
      // First, check if user has permission to update this namespace
      const namespace = await namespacesRepository.findByUuid(
        input.namespaceUuid,
      );

      if (!namespace) {
        return {
          success: false as const,
          message: "Namespace not found",
        };
      }

      // Check if user owns this namespace (only owners can update tool status)
      if (namespace.user_id && namespace.user_id !== userId) {
        return {
          success: false as const,
          message:
            "Access denied: You can only update tool status for namespaces you own",
        };
      }

      const updatedMapping = await namespaceMappingsRepository.updateToolStatus(
        {
          namespaceUuid: input.namespaceUuid,
          toolUuid: input.toolUuid,
          serverUuid: input.serverUuid,
          status: input.status,
        },
      );

      if (!updatedMapping) {
        return {
          success: false as const,
          message: "Tool not found in namespace",
        };
      }

      return {
        success: true as const,
        message: "Tool status updated successfully",
      };
    } catch (error) {
      console.error("Error updating tool status:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  refreshTools: async (
    input: z.infer<typeof RefreshNamespaceToolsRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof RefreshNamespaceToolsResponseSchema>> => {
    try {
      // First, check if user has permission to refresh tools for this namespace
      const namespace = await namespacesRepository.findByUuid(
        input.namespaceUuid,
      );

      if (!namespace) {
        return {
          success: false as const,
          message: "Namespace not found",
        };
      }

      // Check if user owns this namespace (only owners can refresh tools)
      if (namespace.user_id && namespace.user_id !== userId) {
        return {
          success: false as const,
          message:
            "Access denied: You can only refresh tools for namespaces you own",
        };
      }

      if (!input.tools || input.tools.length === 0) {
        return {
          success: true as const,
          message: "No tools to refresh",
          toolsCreated: 0,
          mappingsCreated: 0,
        };
      }

      // Parse tool names to extract server names and actual tool names
      const parsedTools: Array<{
        serverName: string;
        toolName: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }> = [];

      for (const tool of input.tools) {
        // Split by "__" - use last occurrence if there are multiple
        const lastDoubleUnderscoreIndex = tool.name.lastIndexOf("__");

        if (lastDoubleUnderscoreIndex === -1) {
          console.warn(
            `Tool name "${tool.name}" does not contain "__" separator, skipping`,
          );
          continue;
        }

        const serverName = tool.name.substring(0, lastDoubleUnderscoreIndex);
        const toolName = tool.name.substring(lastDoubleUnderscoreIndex + 2);

        if (!serverName || !toolName) {
          console.warn(`Invalid tool name format "${tool.name}", skipping`);
          continue;
        }

        parsedTools.push({
          serverName,
          toolName,
          description: tool.description || "",
          inputSchema: tool.inputSchema,
        });
      }

      if (parsedTools.length === 0) {
        return {
          success: true as const,
          message: "No valid tools to refresh after parsing",
          toolsCreated: 0,
          mappingsCreated: 0,
        };
      }

      // Group tools by server name and resolve server UUIDs
      const toolsByServerName: Record<
        string,
        {
          serverUuid: string;
          tools: Array<{
            toolName: string;
            description: string;
            inputSchema: Record<string, unknown>;
          }>;
        }
      > = {};

      for (const parsedTool of parsedTools) {
        // Find server by name - first try exact match
        let server = await mcpServersRepository.findByName(
          parsedTool.serverName,
        );

        // If exact match fails, try to handle nested MetaMCP scenarios
        // For nested MetaMCP, tool names may be in format "ParentServer__ChildServer__tool"
        // but we need to find the actual "ParentServer" in the database
        if (!server && parsedTool.serverName.includes("__")) {
          // Try the first part before the first "__" (this would be the actual server)
          const firstDoubleUnderscoreIndex =
            parsedTool.serverName.indexOf("__");
          const actualServerName = parsedTool.serverName.substring(
            0,
            firstDoubleUnderscoreIndex,
          );

          server = await mcpServersRepository.findByName(actualServerName);

          if (server) {
            console.log(
              `Found nested MetaMCP server mapping: "${parsedTool.serverName}" -> "${actualServerName}"`,
            );
            // Update the parsed tool to use the correct server name and adjust tool name
            const remainingPart = parsedTool.serverName.substring(
              firstDoubleUnderscoreIndex + 2,
            );
            parsedTool.toolName = `${remainingPart}__${parsedTool.toolName}`;
            parsedTool.serverName = actualServerName;
          }
        }

        if (!server) {
          console.warn(
            `Server "${parsedTool.serverName}" not found in database, skipping tool "${parsedTool.toolName}"`,
          );
          continue;
        }

        if (!toolsByServerName[parsedTool.serverName]) {
          toolsByServerName[parsedTool.serverName] = {
            serverUuid: server.uuid,
            tools: [],
          };
        }

        toolsByServerName[parsedTool.serverName].tools.push({
          toolName: parsedTool.toolName,
          description: parsedTool.description,
          inputSchema: parsedTool.inputSchema,
        });
      }

      if (Object.keys(toolsByServerName).length === 0) {
        return {
          success: false as const,
          message: "No servers found for the provided tools",
        };
      }

      let totalToolsCreated = 0;
      let totalMappingsCreated = 0;

      // Process tools for each server
      for (const [serverName, serverData] of Object.entries(
        toolsByServerName,
      )) {
        const { serverUuid, tools } = serverData;

        // Bulk upsert tools to the tools table with the actual tool names
        const upsertedTools = await toolsRepository.bulkUpsert({
          mcpServerUuid: serverUuid,
          tools: tools.map((tool) => ({
            name: tool.toolName, // Use the actual tool name, not the prefixed name
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });

        totalToolsCreated += upsertedTools.length;

        // Create namespace tool mappings
        const toolMappings = upsertedTools.map((tool) => ({
          toolUuid: tool.uuid,
          serverUuid: serverUuid,
          status: "ACTIVE" as const,
        }));

        const createdMappings =
          await namespaceMappingsRepository.bulkUpsertNamespaceToolMappings({
            namespaceUuid: input.namespaceUuid,
            toolMappings,
          });

        totalMappingsCreated += createdMappings.length;

        console.log(
          `Processed ${tools.length} tools for server "${serverName}" (${serverUuid})`,
        );
      }

      // Invalidate idle MetaMCP server for this namespace since tools were refreshed
      // Run this asynchronously to avoid blocking the response
      metaMcpServerPool
        .invalidateIdleServer(input.namespaceUuid)
        .then(() => {
          console.log(
            `Invalidated idle MetaMCP server for namespace ${input.namespaceUuid} after tools refresh`,
          );
        })
        .catch((error) => {
          console.error(
            `Error invalidating idle MetaMCP server for namespace ${input.namespaceUuid}:`,
            error,
          );
          // Don't fail the entire operation if idle server invalidation fails
        });

      // Also invalidate OpenAPI sessions for this namespace
      metaMcpServerPool
        .invalidateOpenApiSessions([input.namespaceUuid])
        .then(() => {
          console.log(
            `Invalidated OpenAPI session for namespace ${input.namespaceUuid} after tools refresh`,
          );
        })
        .catch((error) => {
          console.error(
            `Error invalidating OpenAPI session for namespace ${input.namespaceUuid}:`,
            error,
          );
          // Don't fail the entire operation if OpenAPI session invalidation fails
        });

      return {
        success: true as const,
        message: `Successfully refreshed ${totalToolsCreated} tools with ${totalMappingsCreated} mappings`,
        toolsCreated: totalToolsCreated,
        mappingsCreated: totalMappingsCreated,
      };
    } catch (error) {
      console.error("Error refreshing namespace tools:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },
};
