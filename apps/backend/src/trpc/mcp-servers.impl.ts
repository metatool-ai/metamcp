import {
  type AccessPrincipal,
  BulkImportMcpServersRequestSchema,
  BulkImportMcpServersResponseSchema,
  CreateMcpServerRequestSchema,
  CreateMcpServerResponseSchema,
  type DatabaseMcpServer,
  DeleteMcpServerResponseSchema,
  GetMcpServerResponseSchema,
  ListMcpServersResponseSchema,
  type McpServer,
  McpServerTypeEnum,
  UpdateMcpServerRequestSchema,
  UpdateMcpServerResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import {
  mcpServersRepository,
  namespaceMappingsRepository,
  oauthSessionsRepository,
} from "../db/repositories";
import { resourceSharesRepository } from "../db/repositories/resource-shares.repo";
import { McpServersSerializer } from "../db/serializers";
import { accessService } from "../lib/access/access.service";
import { loadOwners } from "../lib/access/owners";
import { hasCapability } from "../lib/access/policy";
import {
  decideOwnerForCreate,
  decideOwnerForUpdate,
  forbiddenMessage,
  hasLevel,
  notFoundMessage,
  redactServerSecrets,
} from "../lib/access/resource-guards";
import { activityLog } from "../lib/activity/activity-log.service";
import { publicErrorMessage } from "../lib/errors";
import { mcpServerPool } from "../lib/metamcp/mcp-server-pool";
import { clearOverrideCache } from "../lib/metamcp/metamcp-middleware/tool-overrides.functional";
import { metaMcpServerPool } from "../lib/metamcp/metamcp-server-pool";
import { serverErrorTracker } from "../lib/metamcp/server-error-tracker";
import { serverSnapshots } from "../lib/metamcp/server-snapshots";
import { convertDbServerToParams } from "../lib/metamcp/utils";
import { persistPreRegisteredOAuthClient } from "./pre-registered-oauth";

const STDIO_CAPABILITY_MESSAGE =
  'Access denied: STDIO MCP servers run commands on the MetaMCP host and require the "STDIO servers" permission. Ask an administrator.';

/** Adds the caller's access, the owner and redaction to each visible server. */
export async function serializeServersForPrincipal(
  principal: AccessPrincipal,
  servers: DatabaseMcpServer[],
): Promise<McpServer[]> {
  const [accessMap, owners, shareCounts] = await Promise.all([
    accessService.resolveAccess(principal, "mcp_server", servers),
    loadOwners(servers.map((server) => server.user_id)),
    resourceSharesRepository.countForResources(
      "mcp_server",
      servers.map((server) => server.uuid),
    ),
  ]);

  return servers.flatMap((server) => {
    const access = accessMap.get(server.uuid);
    if (!access) return [];
    const serialized: McpServer = {
      ...McpServersSerializer.serializeMcpServer(server),
      access,
      owner: server.user_id ? (owners.get(server.user_id) ?? null) : null,
      shareCount: shareCounts.get(server.uuid) ?? 0,
      secretsRedacted: false,
    };
    return [
      access.level === "use" ? redactServerSecrets(serialized) : serialized,
    ];
  });
}

function sortedEntries(record: Record<string, string> | undefined | null) {
  return JSON.stringify(
    Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** True when a create/update defines or changes what a STDIO server executes. */
function touchesStdioExecution(
  existing: DatabaseMcpServer | null,
  input: {
    type?: string;
    command?: string | null;
    args?: string[];
    env?: Record<string, string>;
  },
): boolean {
  const nextType = input.type ?? existing?.type ?? McpServerTypeEnum.enum.STDIO;
  const involvesStdio =
    nextType === McpServerTypeEnum.enum.STDIO ||
    existing?.type === McpServerTypeEnum.enum.STDIO;
  if (!involvesStdio) return false;
  if (!existing || existing.type !== nextType) return true;
  return (
    (input.command ?? null) !== (existing.command ?? null) ||
    JSON.stringify(input.args ?? []) !== JSON.stringify(existing.args ?? []) ||
    sortedEntries(input.env) !== sortedEntries(existing.env)
  );
}

type ServerSnapshot = {
  name: string;
  description: string | null;
  type: string;
  command: string | null;
  url: string | null;
  bearerToken: string | null;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  user_id: string | null;
};

/** Names of the fields that changed (never their values: they are secrets). */
function changedServerFields(
  before: ServerSnapshot,
  after: ServerSnapshot,
): string[] {
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const fields: string[] = [];
  for (const key of [
    "name",
    "description",
    "type",
    "command",
    "url",
    "bearerToken",
    "args",
  ] as const) {
    if (!same(before[key], after[key])) fields.push(key);
  }
  for (const map of ["env", "headers"] as const) {
    const names = new Set([
      ...Object.keys(before[map] ?? {}),
      ...Object.keys(after[map] ?? {}),
    ]);
    for (const name of names) {
      if ((before[map] ?? {})[name] !== (after[map] ?? {})[name]) {
        fields.push(`${map}.${name}`);
      }
    }
  }
  if (before.user_id !== after.user_id) fields.push("owner");
  return fields;
}

const serverTarget = (server: { uuid: string; name: string }) => ({
  type: "mcp_server",
  id: server.uuid,
  label: server.name,
});

export const mcpServersImplementations = {
  create: async (
    input: z.infer<typeof CreateMcpServerRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof CreateMcpServerResponseSchema>> => {
    try {
      if (!hasCapability(principal, "mcp_servers.create")) {
        return {
          success: false as const,
          message:
            "Access denied: your role does not allow adding MCP servers.",
        };
      }
      if (
        touchesStdioExecution(null, input) &&
        !hasCapability(principal, "mcp_servers.create_stdio")
      ) {
        return { success: false as const, message: STDIO_CAPABILITY_MESSAGE };
      }

      const ownerDecision = decideOwnerForCreate(principal, input.user_id);
      if (!ownerDecision.ok) {
        return { success: false as const, message: ownerDecision.message };
      }
      const effectiveUserId = ownerDecision.ownerId;

      const { oauth_client_info: oauthClientInfo, ...serverInput } = input;

      const createdServer = await mcpServersRepository.create({
        ...serverInput,
        user_id: effectiveUserId,
      });

      if (!createdServer) {
        return {
          success: false as const,
          message: "Failed to create MCP server",
        };
      }

      // Persist pre-registered upstream OAuth client when provided. Failure
      // here should not roll back the server creation, but it is surfaced as
      // an error response so the caller can retry.
      if (oauthClientInfo) {
        try {
          await persistPreRegisteredOAuthClient(
            createdServer.uuid,
            oauthClientInfo,
            oauthSessionsRepository,
          );
        } catch (error) {
          logger.error(
            `Error persisting pre-registered OAuth client for server ${createdServer.uuid}:`,
            error,
          );
          return {
            success: false as const,
            message:
              error instanceof Error
                ? `Server created but OAuth client persistence failed: ${error.message}`
                : "Server created but OAuth client persistence failed",
          };
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

      await activityLog.record({
        actor: principal,
        action: "mcp_server.created",
        target: serverTarget(createdServer),
        details: {
          type: createdServer.type,
          owner: createdServer.user_id ? "user" : "organisation",
        },
      });

      const [data] = await serializeServersForPrincipal(principal, [
        createdServer,
      ]);
      return {
        success: true as const,
        data: data ?? McpServersSerializer.serializeMcpServer(createdServer),
        message: "MCP server created successfully",
      };
    } catch (error) {
      logger.error("Error creating MCP server:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  list: async (
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof ListMcpServersResponseSchema>> => {
    try {
      // Servers the caller owns or that are shared with them (all for admins)
      const filter = await accessService.accessibleFilter(
        principal,
        "mcp_server",
      );
      const servers = await mcpServersRepository.findAllByAccess(filter);

      return {
        success: true as const,
        data: await serializeServersForPrincipal(principal, servers),
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
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof BulkImportMcpServersResponseSchema>> => {
    const userId = principal.userId;
    try {
      if (!hasCapability(principal, "mcp_servers.create")) {
        return {
          success: false as const,
          imported: 0,
          message:
            "Access denied: your role does not allow adding MCP servers.",
        };
      }
      const canCreateStdio = hasCapability(
        principal,
        "mcp_servers.create_stdio",
      );
      const serversToInsert = [];
      const errors: string[] = [];
      let imported = 0;

      for (const [serverName, serverConfig] of Object.entries(
        input.mcpServers,
      )) {
        try {
          // Validate server name format (same rules as create / update:
          // "__" separates the server prefix from tool names)
          if (!/^[a-zA-Z0-9_-]+$/.test(serverName)) {
            throw new Error(
              `Server name "${serverName}" is invalid. Server names must only contain letters, numbers, underscores, and hyphens.`,
            );
          }
          if (/_{2,}/.test(serverName)) {
            throw new Error(
              `Server name "${serverName}" is invalid. Server names cannot contain consecutive underscores.`,
            );
          }

          if ((serverConfig.type || "STDIO") === "STDIO" && !canCreateStdio) {
            throw new Error(STDIO_CAPABILITY_MESSAGE);
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
            forward_headers: serverConfig.forward_headers || {},
            user_id: userId, // Default bulk imported servers to current user
          };

          serversToInsert.push(serverWithDefaults);
        } catch (error) {
          errors.push(
            `Failed to process server "${serverName}": ${publicErrorMessage(error, "Unknown error")}`,
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
                `Error processing idle session for bulk imported server ${server.name} (${server.uuid}):`,
                error,
              );
            }
          });
        }
      }

      if (imported > 0) {
        await activityLog.record({
          actor: principal,
          action: "mcp_server.created",
          target: { type: "mcp_server", id: null, label: null },
          details: {
            import: true,
            count: imported,
            names: Object.keys(input.mcpServers).slice(0, 50),
          },
        });
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
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof GetMcpServerResponseSchema>> => {
    try {
      const server = await mcpServersRepository.findByUuid(input.uuid);
      const [data] = server
        ? await serializeServersForPrincipal(principal, [server])
        : [];

      if (!data) {
        return {
          success: false as const,
          message: notFoundMessage("MCP server"),
        };
      }

      return {
        success: true as const,
        data,
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
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof DeleteMcpServerResponseSchema>> => {
    try {
      // Check if server exists and user has permission to delete it
      const server = await mcpServersRepository.findByUuid(input.uuid);
      const access = server
        ? await accessService.resolveAccessOne(principal, "mcp_server", server)
        : null;

      if (!server || !access) {
        return {
          success: false as const,
          message: notFoundMessage("MCP server"),
        };
      }

      // Deleting requires "manage" (owner, admin or explicit manage share)
      if (!hasLevel(access, "manage")) {
        return {
          success: false as const,
          message: forbiddenMessage("delete this MCP server", "manage"),
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

      await activityLog.record({
        actor: principal,
        action: "mcp_server.deleted",
        target: serverTarget(deletedServer),
        details: { type: deletedServer.type },
      });

      return {
        success: true as const,
        message: "MCP server deleted successfully",
      };
    } catch (error) {
      logger.error("Error deleting MCP server:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  update: async (
    input: z.infer<typeof UpdateMcpServerRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof UpdateMcpServerResponseSchema>> => {
    try {
      // Check if server exists and user has permission to update it
      const server = await mcpServersRepository.findByUuid(input.uuid);
      const access = server
        ? await accessService.resolveAccessOne(principal, "mcp_server", server)
        : null;

      if (!server || !access) {
        return {
          success: false as const,
          message: notFoundMessage("MCP server"),
        };
      }

      if (!hasLevel(access, "edit")) {
        return {
          success: false as const,
          message: forbiddenMessage("edit this MCP server", "edit"),
        };
      }

      if (
        touchesStdioExecution(server, input) &&
        !hasCapability(principal, "mcp_servers.create_stdio")
      ) {
        return { success: false as const, message: STDIO_CAPABILITY_MESSAGE };
      }

      // Ownership only changes when an administrator explicitly moves it
      const ownerDecision = decideOwnerForUpdate(
        principal,
        server.user_id,
        input.user_id,
      );
      if (!ownerDecision.ok) {
        return { success: false as const, message: ownerDecision.message };
      }
      const effectiveUserId = ownerDecision.ownerId;

      const { oauth_client_info: oauthClientInfo, ...serverInput } = input;

      const updatedServer = await mcpServersRepository.update({
        ...serverInput,
        user_id: effectiveUserId,
      });

      if (!updatedServer) {
        return {
          success: false as const,
          message: "MCP server not found",
        };
      }

      if (oauthClientInfo) {
        try {
          await persistPreRegisteredOAuthClient(
            updatedServer.uuid,
            oauthClientInfo,
            oauthSessionsRepository,
          );
        } catch (error) {
          logger.error(
            `Error persisting pre-registered OAuth client for server ${updatedServer.uuid}:`,
            error,
          );
          return {
            success: false as const,
            message:
              error instanceof Error
                ? `Server updated but OAuth client persistence failed: ${error.message}`
                : "Server updated but OAuth client persistence failed",
          };
        }
      }

      // Reset error status for stdio servers when they are updated
      if (updatedServer.type === McpServerTypeEnum.enum.STDIO) {
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
      }

      // What it listed may change with its configuration
      await serverSnapshots.forget(updatedServer.uuid);

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

      if (server) {
        const changedFields = changedServerFields(server, updatedServer);
        if (changedFields.length > 0) {
          await activityLog.record({
            actor: principal,
            action: "mcp_server.updated",
            target: serverTarget(updatedServer),
            details: { changedFields },
          });
        }
      }

      const [data] = await serializeServersForPrincipal(principal, [
        updatedServer,
      ]);
      return {
        success: true as const,
        data: data ?? McpServersSerializer.serializeMcpServer(updatedServer),
        message: "MCP server updated successfully",
      };
    } catch (error) {
      logger.error("Error updating MCP server:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },
};
