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

import logger from "@/utils/logger";

import {
  mcpServersRepository,
  namespaceMappingsRepository,
} from "../db/repositories";
import { McpServersSerializer } from "../db/serializers";
import {
  computeCommandHash,
  ensurePodAndService,
  waitForReady,
  deletePodAndService,
} from "../lib/k8s";
import { mcpServerPool } from "../lib/metamcp/mcp-server-pool";
import { clearOverrideCache } from "../lib/metamcp/metamcp-middleware/tool-overrides.functional";
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

      let createdServer = await mcpServersRepository.create({
        ...input,
        user_id: effectiveUserId,
      });

      if (!createdServer) {
        return {
          success: false as const,
          message: "Failed to create MCP server",
        };
      }

      // For STDIO servers, ensure K8s Pod+Service and update DB with hash/URL
      if (createdServer.type === McpServerTypeEnum.Enum.STDIO && createdServer.command) {
        try {
          const hash = computeCommandHash(createdServer.command, createdServer.args || []);
          const serviceUrl = await ensurePodAndService({
            commandHash: hash,
            command: createdServer.command,
            args: createdServer.args || [],
            env: createdServer.env || {},
          });
          await waitForReady(hash);
          const updated = await mcpServersRepository.update({
            uuid: createdServer.uuid,
            k8s_command_hash: hash,
            k8s_service_url: serviceUrl,
          });
          if (updated) {
            createdServer = updated;
          }
        } catch (error) {
          logger.error(
            `Error ensuring K8s Pod for newly created server ${createdServer.name} (${createdServer.uuid}):`,
            error,
          );
        }
      }

      // Ensure idle session for the newly created server (async)
      const serverParams = await convertDbServerToParams(createdServer);
      if (serverParams) {
        mcpServerPool
          .ensureIdleSessionForNewServer(createdServer.uuid, serverParams)
          .then(() => {
            logger.info(
              `Ensured idle session for newly created server: ${createdServer.name} (${createdServer.uuid})`,
            );
          })
          .catch((error) => {
            logger.error(
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
      logger.error("Error creating MCP server:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  list: async (
    userId: string,
    userRole: string = "user",
  ): Promise<z.infer<typeof ListMcpServersResponseSchema>> => {
    try {
      // Admin can see all servers, regular users see public + own
      const servers = userRole === "admin"
        ? await mcpServersRepository.findAll()
        : await mcpServersRepository.findAllAccessibleToUser(userId);

      return {
        success: true as const,
        data: McpServersSerializer.serializeMcpServerList(servers),
        message: "MCP servers retrieved successfully",
      };
    } catch (error) {
      logger.error("Error fetching MCP servers:", error);
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
            headers: serverConfig.headers || {},
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

        // Ensure K8s Pods and idle sessions for all imported servers (async)
        if (createdServers && createdServers.length > 0) {
          createdServers.forEach(async (server) => {
            try {
              // For STDIO servers, ensure K8s Pod+Service
              if (server.type === McpServerTypeEnum.Enum.STDIO && server.command) {
                try {
                  const hash = computeCommandHash(server.command, server.args || []);
                  const serviceUrl = await ensurePodAndService({
                    commandHash: hash,
                    command: server.command,
                    args: server.args || [],
                    env: server.env || {},
                  });
                  await waitForReady(hash);
                  await mcpServersRepository.update({
                    uuid: server.uuid,
                    k8s_command_hash: hash,
                    k8s_service_url: serviceUrl,
                  });
                } catch (k8sError) {
                  logger.error(
                    `Error ensuring K8s Pod for bulk imported server ${server.name} (${server.uuid}):`,
                    k8sError,
                  );
                }
              }

              const params = await convertDbServerToParams(server);
              if (params) {
                mcpServerPool
                  .ensureIdleSessionForNewServer(server.uuid, params)
                  .then(() => {
                    logger.info(
                      `Ensured idle session for bulk imported server: ${server.name} (${server.uuid})`,
                    );
                  })
                  .catch((error) => {
                    logger.error(
                      `Error ensuring idle session for bulk imported server ${server.name} (${server.uuid}):`,
                      error,
                    );
                  });
              }
            } catch (error) {
              logger.error(
                `Error processing bulk imported server ${server.name} (${server.uuid}):`,
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
      logger.error("Error bulk importing MCP servers:", error);
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
    userRole: string = "user",
  ): Promise<z.infer<typeof GetMcpServerResponseSchema>> => {
    try {
      const server = await mcpServersRepository.findByUuid(input.uuid);

      // Check if user has access to this server (own server or public server, admin bypasses)
      if (server && server.user_id && server.user_id !== userId && userRole !== "admin") {
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
      logger.error("Error fetching MCP server:", error);
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
    userRole: string = "user",
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

      // Only server owner can delete their own servers (admin bypasses)
      if (server.user_id && server.user_id !== userId && userRole !== "admin") {
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

      // If STDIO server, check if we should delete K8s Pod+Service
      if (deletedServer.k8s_command_hash) {
        try {
          const refCount = await mcpServersRepository.countByCommandHash(
            deletedServer.k8s_command_hash,
          );
          if (refCount === 0) {
            // No other servers reference this hash, delete K8s resources
            await deletePodAndService(deletedServer.k8s_command_hash);
            logger.info(
              `Deleted K8s Pod+Service for hash ${deletedServer.k8s_command_hash} (last reference removed)`,
            );
          } else {
            logger.info(
              `K8s Pod+Service for hash ${deletedServer.k8s_command_hash} retained (${refCount} other references)`,
            );
          }
        } catch (error) {
          logger.error(
            `Error cleaning up K8s resources for deleted server ${deletedServer.uuid}:`,
            error,
          );
        }
      }

      // Invalidate idle MetaMCP servers for all affected namespaces (async)
      if (affectedNamespaceUuids.length > 0) {
        metaMcpServerPool
          .invalidateIdleServers(affectedNamespaceUuids)
          .then(() => {
            logger.info(
              `Invalidated idle MetaMCP servers for ${affectedNamespaceUuids.length} namespaces after deleting server: ${deletedServer.name} (${deletedServer.uuid})`,
            );
          })
          .catch((error) => {
            logger.error(
              `Error invalidating idle MetaMCP servers after deleting server ${deletedServer.uuid}:`,
              error,
            );
          });

        // Also invalidate OpenAPI sessions for affected namespaces
        metaMcpServerPool
          .invalidateOpenApiSessions(affectedNamespaceUuids)
          .then(() => {
            logger.info(
              `Invalidated OpenAPI sessions for ${affectedNamespaceUuids.length} namespaces after deleting server: ${deletedServer.name} (${deletedServer.uuid})`,
            );
          })
          .catch((error) => {
            logger.error(
              `Error invalidating OpenAPI sessions after deleting server ${deletedServer.uuid}:`,
              error,
            );
          });

        // Clear tool overrides cache for affected namespaces since server deletion affects tool availability
        affectedNamespaceUuids.forEach((namespaceUuid) => {
          clearOverrideCache(namespaceUuid);
        });
        logger.info(
          `Cleared tool overrides cache for ${affectedNamespaceUuids.length} namespaces after deleting server: ${deletedServer.name} (${deletedServer.uuid})`,
        );
      }

      return {
        success: true as const,
        message: "MCP server deleted successfully",
      };
    } catch (error) {
      logger.error("Error deleting MCP server:", error);
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
    userRole: string = "user",
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

      // Only server owner can update their own servers (admin bypasses)
      if (server.user_id && server.user_id !== userId && userRole !== "admin") {
        return {
          success: false as const,
          message: "Access denied: You can only update servers you own",
        };
      }

      // Determine user ownership based on input.user_id or keep existing ownership
      const effectiveUserId =
        input.user_id !== undefined ? input.user_id : server.user_id;

      let updatedServer = await mcpServersRepository.update({
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
          logger.info(
            `Reset error status for updated stdio server: ${updatedServer.name} (${updatedServer.uuid})`,
          );
        } catch (error) {
          logger.error(
            `Error resetting error status for updated stdio server ${updatedServer.name} (${updatedServer.uuid}):`,
            error,
          );
        }

        // Handle K8s Pod+Service for STDIO servers
        if (updatedServer.command) {
          try {
            const newHash = computeCommandHash(updatedServer.command, updatedServer.args || []);
            const oldHash = server.k8s_command_hash;

            // If command/args changed, handle old Pod cleanup
            if (oldHash && oldHash !== newHash) {
              const oldRefCount = await mcpServersRepository.countByCommandHash(oldHash);
              if (oldRefCount === 0) {
                await deletePodAndService(oldHash);
                logger.info(`Deleted old K8s Pod+Service for hash ${oldHash}`);
              }
            }

            // Ensure new Pod+Service
            const serviceUrl = await ensurePodAndService({
              commandHash: newHash,
              command: updatedServer.command,
              args: updatedServer.args || [],
              env: updatedServer.env || {},
            });
            await waitForReady(newHash);

            // Update DB with new hash/URL
            if (newHash !== updatedServer.k8s_command_hash || serviceUrl !== updatedServer.k8s_service_url) {
              const updated = await mcpServersRepository.update({
                uuid: updatedServer.uuid,
                k8s_command_hash: newHash,
                k8s_service_url: serviceUrl,
              });
              if (updated) {
                updatedServer = updated;
              }
            }
          } catch (error) {
            logger.error(
              `Error updating K8s Pod for server ${updatedServer.name} (${updatedServer.uuid}):`,
              error,
            );
          }
        }
      }

      // Invalidate idle session for the updated server to refresh with new parameters (async)
      const serverParams = await convertDbServerToParams(updatedServer);
      if (serverParams) {
        mcpServerPool
          .invalidateIdleSession(updatedServer.uuid, serverParams)
          .then(() => {
            logger.info(
              `Invalidated and refreshed idle session for updated server: ${updatedServer.name} (${updatedServer.uuid})`,
            );
          })
          .catch((error) => {
            logger.error(
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
            logger.info(
              `Invalidated idle MetaMCP servers for ${affectedNamespaceUuids.length} namespaces after updating server: ${updatedServer.name} (${updatedServer.uuid})`,
            );
          })
          .catch((error) => {
            logger.error(
              `Error invalidating idle MetaMCP servers after updating server ${updatedServer.uuid}:`,
              error,
            );
          });

        // Also invalidate OpenAPI sessions for affected namespaces
        metaMcpServerPool
          .invalidateOpenApiSessions(affectedNamespaceUuids)
          .then(() => {
            logger.info(
              `Invalidated OpenAPI sessions for ${affectedNamespaceUuids.length} namespaces after updating server: ${updatedServer.name} (${updatedServer.uuid})`,
            );
          })
          .catch((error) => {
            logger.error(
              `Error invalidating OpenAPI sessions after updating server ${updatedServer.uuid}:`,
              error,
            );
          });

        // Clear tool overrides cache for affected namespaces since server update may affect tool availability
        affectedNamespaceUuids.forEach((namespaceUuid) => {
          clearOverrideCache(namespaceUuid);
        });
        logger.info(
          `Cleared tool overrides cache for ${affectedNamespaceUuids.length} namespaces after updating server: ${updatedServer.name} (${updatedServer.uuid})`,
        );
      }

      return {
        success: true as const,
        data: McpServersSerializer.serializeMcpServer(updatedServer),
        message: "MCP server updated successfully",
      };
    } catch (error) {
      logger.error("Error updating MCP server:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },
};
