import {
  BulkImportMcpServersRequestSchema,
  BulkImportMcpServersResponseSchema,
  CreateMcpServerRequestSchema,
  CreateMcpServerResponseSchema,
  DeleteMcpServerResponseSchema,
  GetMcpServerResponseSchema,
  ListMcpServersResponseSchema,
  McpServerTypeEnum,
  UpdateMcpServerRequestSchema,
  UpdateMcpServerResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import {
  mcpServersRepository,
  namespaceMappingsRepository,
} from "../db/repositories";
import { McpServersSerializer } from "../db/serializers";
import { mcpServerPool } from "../lib/metamcp/mcp-server-pool";
import { metaMcpServerPool } from "../lib/metamcp/metamcp-server-pool";
import { serverErrorTracker } from "../lib/metamcp/server-error-tracker";
import { convertDbServerToParams } from "../lib/metamcp/utils";

export const mcpServersImplementations = {
  create: async (
    input: z.infer<typeof CreateMcpServerRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof CreateMcpServerResponseSchema>> => {
    try {
      // Determine user ownership based on input.user_id or default to current user
      const effectiveUserId =
        input.user_id !== undefined ? input.user_id : userId;

      const createdServer = await mcpServersRepository.create({
        ...input,
        user_id: effectiveUserId,
      });

      if (!createdServer) {
        return {
          success: false as const,
          message: "Failed to create MCP server",
        };
      }

      // Ensure idle session for the newly created server (async)
      const serverParams = await convertDbServerToParams(createdServer);
      if (serverParams) {
        mcpServerPool
          .ensureIdleSessionForNewServer(createdServer.uuid, serverParams)
          .then(() => {
            console.log(
              `Ensured idle session for newly created server: ${createdServer.name} (${createdServer.uuid})`,
            );
          })
          .catch((error) => {
            console.error(
              `Error ensuring idle session for newly created server ${createdServer.name} (${createdServer.uuid}):`,
              error,
            );
          });
      }

      return {
        success: true as const,
        data: McpServersSerializer.serializeMcpServer(createdServer),
        message: "MCP server created successfully",
      };
    } catch (error) {
      console.error("Error creating MCP server:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  list: async (
    userId: string,
  ): Promise<z.infer<typeof ListMcpServersResponseSchema>> => {
    try {
      // Find servers accessible to user (public + user's own)
      const servers =
        await mcpServersRepository.findAllAccessibleToUser(userId);

      return {
        success: true as const,
        data: McpServersSerializer.serializeMcpServerList(servers),
        message: "MCP servers retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching MCP servers:", error);
      return {
        success: false as const,
        data: [],
        message: "Failed to fetch MCP servers",
      };
    }
  },

  bulkImport: async (
    input: z.infer<typeof BulkImportMcpServersRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof BulkImportMcpServersResponseSchema>> => {
    try {
      const serversToInsert = [];
      const errors: string[] = [];
      let imported = 0;

      for (const [serverName, serverConfig] of Object.entries(
        input.mcpServers,
      )) {
        try {
          // Validate server name format
          if (!/^[a-zA-Z0-9_-]+$/.test(serverName)) {
            throw new Error(
              `Server name "${serverName}" is invalid. Server names must only contain letters, numbers, underscores, and hyphens.`,
            );
          }

          // Provide default type if not specified
          const serverWithDefaults = {
            name: serverName,
            type: serverConfig.type || ("STDIO" as const),
            description: serverConfig.description || null,
            command: serverConfig.command || null,
            args: serverConfig.args || [],
            env: serverConfig.env || {},
            url: serverConfig.url || null,
            bearerToken: undefined,
            user_id: userId, // Default bulk imported servers to current user
          };

          serversToInsert.push(serverWithDefaults);
        } catch (error) {
          errors.push(
            `Failed to process server "${serverName}": ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }

      if (serversToInsert.length > 0) {
        const createdServers =
          await mcpServersRepository.bulkCreate(serversToInsert);
        imported = serversToInsert.length;

        // Ensure idle sessions for all imported servers (async)
        if (createdServers && createdServers.length > 0) {
          createdServers.forEach(async (server) => {
            try {
              const params = await convertDbServerToParams(server);
              if (params) {
                mcpServerPool
                  .ensureIdleSessionForNewServer(server.uuid, params)
                  .then(() => {
                    console.log(
                      `Ensured idle session for bulk imported server: ${server.name} (${server.uuid})`,
                    );
                  })
                  .catch((error) => {
                    console.error(
                      `Error ensuring idle session for bulk imported server ${server.name} (${server.uuid}):`,
                      error,
                    );
                  });
              }
            } catch (error) {
              console.error(
                `Error processing idle session for bulk imported server ${server.name} (${server.uuid}):`,
                error,
              );
            }
          });
        }
      }

      return {
        success: true as const,
        imported,
        errors: errors.length > 0 ? errors : undefined,
        message: `Successfully imported ${imported} MCP servers${errors.length > 0 ? ` with ${errors.length} errors` : ""}`,
      };
    } catch (error) {
      console.error("Error bulk importing MCP servers:", error);
      return {
        success: false as const,
        imported: 0,
        message:
          error instanceof Error
            ? error.message
            : "Internal server error during bulk import",
      };
    }
  },

  get: async (
    input: {
      uuid: string;
    },
    userId: string,
  ): Promise<z.infer<typeof GetMcpServerResponseSchema>> => {
    try {
      const server = await mcpServersRepository.findByUuid(input.uuid);

      // Check if user has access to this server (own server or public server)
      if (server && server.user_id && server.user_id !== userId) {
        return {
          success: false as const,
          message:
            "Access denied: You can only view servers you own or public servers",
        };
      }

      if (!server) {
        return {
          success: false as const,
          message: "MCP server not found",
        };
      }

      return {
        success: true as const,
        data: McpServersSerializer.serializeMcpServer(server),
        message: "MCP server retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching MCP server:", error);
      return {
        success: false as const,
        message: "Failed to fetch MCP server",
      };
    }
  },

  delete: async (
    input: {
      uuid: string;
    },
    userId: string,
  ): Promise<z.infer<typeof DeleteMcpServerResponseSchema>> => {
    try {
      // Check if server exists and user has permission to delete it
      const server = await mcpServersRepository.findByUuid(input.uuid);

      if (!server) {
        return {
          success: false as const,
          message: "MCP server not found",
        };
      }

      // Only server owner can delete their own servers, only admin can delete public servers
      if (server.user_id && server.user_id !== userId) {
        return {
          success: false as const,
          message: "Access denied: You can only delete servers you own",
        };
      }

      // Find affected namespaces before deleting the server
      const affectedNamespaceUuids =
        await namespaceMappingsRepository.findNamespacesByServerUuid(
          input.uuid,
        );

      // Clean up any idle sessions for this server
      await mcpServerPool.cleanupIdleSession(input.uuid);

      const deletedServer = await mcpServersRepository.deleteByUuid(input.uuid);

      if (!deletedServer) {
        return {
          success: false as const,
          message: "MCP server not found",
        };
      }

      // Invalidate idle MetaMCP servers for all affected namespaces (async)
      if (affectedNamespaceUuids.length > 0) {
        metaMcpServerPool
          .invalidateIdleServers(affectedNamespaceUuids)
          .then(() => {
            console.log(
              `Invalidated idle MetaMCP servers for ${affectedNamespaceUuids.length} namespaces after deleting server: ${deletedServer.name} (${deletedServer.uuid})`,
            );
          })
          .catch((error) => {
            console.error(
              `Error invalidating idle MetaMCP servers after deleting server ${deletedServer.uuid}:`,
              error,
            );
          });

        // Also invalidate OpenAPI sessions for affected namespaces
        metaMcpServerPool
          .invalidateOpenApiSessions(affectedNamespaceUuids)
          .then(() => {
            console.log(
              `Invalidated OpenAPI sessions for ${affectedNamespaceUuids.length} namespaces after deleting server: ${deletedServer.name} (${deletedServer.uuid})`,
            );
          })
          .catch((error) => {
            console.error(
              `Error invalidating OpenAPI sessions after deleting server ${deletedServer.uuid}:`,
              error,
            );
          });
      }

      return {
        success: true as const,
        message: "MCP server deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting MCP server:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  update: async (
    input: z.infer<typeof UpdateMcpServerRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof UpdateMcpServerResponseSchema>> => {
    try {
      // Check if server exists and user has permission to update it
      const server = await mcpServersRepository.findByUuid(input.uuid);

      if (!server) {
        return {
          success: false as const,
          message: "MCP server not found",
        };
      }

      // Only server owner can update their own servers, only admin can update public servers
      if (server.user_id && server.user_id !== userId) {
        return {
          success: false as const,
          message: "Access denied: You can only update servers you own",
        };
      }

      // Determine user ownership based on input.user_id or keep existing ownership
      const effectiveUserId =
        input.user_id !== undefined ? input.user_id : server.user_id;

      const updatedServer = await mcpServersRepository.update({
        ...input,
        user_id: effectiveUserId,
      });

      if (!updatedServer) {
        return {
          success: false as const,
          message: "MCP server not found",
        };
      }

      // Reset error status for stdio servers when they are updated
      if (updatedServer.type === McpServerTypeEnum.Enum.STDIO) {
        try {
          await serverErrorTracker.resetServerErrorState(updatedServer.uuid);
          console.log(
            `Reset error status for updated stdio server: ${updatedServer.name} (${updatedServer.uuid})`,
          );
        } catch (error) {
          console.error(
            `Error resetting error status for updated stdio server ${updatedServer.name} (${updatedServer.uuid}):`,
            error,
          );
        }
      }

      // Invalidate idle session for the updated server to refresh with new parameters (async)
      const serverParams = await convertDbServerToParams(updatedServer);
      if (serverParams) {
        mcpServerPool
          .invalidateIdleSession(updatedServer.uuid, serverParams)
          .then(() => {
            console.log(
              `Invalidated and refreshed idle session for updated server: ${updatedServer.name} (${updatedServer.uuid})`,
            );
          })
          .catch((error) => {
            console.error(
              `Error invalidating idle session for updated server ${updatedServer.name} (${updatedServer.uuid}):`,
              error,
            );
          });
      }

      // Find affected namespaces and invalidate their idle MetaMCP servers (async)
      const affectedNamespaceUuids =
        await namespaceMappingsRepository.findNamespacesByServerUuid(
          updatedServer.uuid,
        );

      if (affectedNamespaceUuids.length > 0) {
        metaMcpServerPool
          .invalidateIdleServers(affectedNamespaceUuids)
          .then(() => {
            console.log(
              `Invalidated idle MetaMCP servers for ${affectedNamespaceUuids.length} namespaces after updating server: ${updatedServer.name} (${updatedServer.uuid})`,
            );
          })
          .catch((error) => {
            console.error(
              `Error invalidating idle MetaMCP servers after updating server ${updatedServer.uuid}:`,
              error,
            );
          });

        // Also invalidate OpenAPI sessions for affected namespaces
        metaMcpServerPool
          .invalidateOpenApiSessions(affectedNamespaceUuids)
          .then(() => {
            console.log(
              `Invalidated OpenAPI sessions for ${affectedNamespaceUuids.length} namespaces after updating server: ${updatedServer.name} (${updatedServer.uuid})`,
            );
          })
          .catch((error) => {
            console.error(
              `Error invalidating OpenAPI sessions after updating server ${updatedServer.uuid}:`,
              error,
            );
          });
      }

      return {
        success: true as const,
        data: McpServersSerializer.serializeMcpServer(updatedServer),
        message: "MCP server updated successfully",
      };
    } catch (error) {
      console.error("Error updating MCP server:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },
};
