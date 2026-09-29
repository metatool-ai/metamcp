import {
  type AccessPrincipal,
  CreateNamespaceRequestSchema,
  CreateNamespaceResponseSchema,
  type DatabaseMcpServer,
  type DatabaseNamespace,
  DeleteNamespaceResponseSchema,
  GetNamespaceResponseSchema,
  GetNamespaceToolsRequestSchema,
  GetNamespaceToolsResponseSchema,
  ListNamespacesResponseSchema,
  type Namespace,
  RefreshNamespaceToolsRequestSchema,
  RefreshNamespaceToolsResponseSchema,
  UpdateNamespaceRequestSchema,
  UpdateNamespaceResponseSchema,
  UpdateNamespaceServerStatusRequestSchema,
  UpdateNamespaceServerStatusResponseSchema,
  UpdateNamespaceToolOverridesRequestSchema,
  UpdateNamespaceToolOverridesResponseSchema,
  UpdateNamespaceToolStatusRequestSchema,
  UpdateNamespaceToolStatusResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import {
  endpointsRepository,
  mcpServersRepository,
  namespaceMappingsRepository,
  namespacesRepository,
  toolsRepository,
} from "../db/repositories";
import { resourceSharesRepository } from "../db/repositories/resource-shares.repo";
import { NamespacesSerializer } from "../db/serializers";
import { accessService } from "../lib/access/access.service";
import { endpointAccessCache } from "../lib/access/endpoint-access-cache";
import { loadOwners } from "../lib/access/owners";
import { hasCapability } from "../lib/access/policy";
import { checkEmbeddedCredentialRedistribution } from "../lib/access/redistribution";
import {
  decideOwnerForCreate,
  decideOwnerForUpdate,
  forbiddenMessage,
  hasLevel,
  notFoundMessage,
  redactServerSecrets,
} from "../lib/access/resource-guards";
import {
  describeRedistributionError,
  findNonRedistributableServers,
} from "../lib/access/sharing-rules";
import { activityLog } from "../lib/activity/activity-log.service";
import { publicErrorMessage } from "../lib/errors";
import {
  clearOverrideCache,
  mapOverrideNameToOriginal,
} from "../lib/metamcp/metamcp-middleware/tool-overrides.functional";
import { metaMcpServerPool } from "../lib/metamcp/metamcp-server-pool";

/** Adds the caller's access, the owner and the share count to namespaces. */
export async function serializeNamespacesForPrincipal(
  principal: AccessPrincipal,
  namespaces: DatabaseNamespace[],
): Promise<Namespace[]> {
  const [accessMap, owners, shareCounts] = await Promise.all([
    accessService.resolveAccess(principal, "namespace", namespaces),
    loadOwners(namespaces.map((namespace) => namespace.user_id)),
    resourceSharesRepository.countForResources(
      "namespace",
      namespaces.map((namespace) => namespace.uuid),
    ),
  ]);
  return namespaces.flatMap((namespace) => {
    const access = accessMap.get(namespace.uuid);
    if (!access) return [];
    return [
      {
        ...NamespacesSerializer.serializeNamespace(namespace),
        access,
        owner: namespace.user_id
          ? (owners.get(namespace.user_id) ?? null)
          : null,
        shareCount: shareCounts.get(namespace.uuid) ?? 0,
      },
    ];
  });
}

/**
 * Validates the servers a namespace will contain: they must exist and be
 * usable by the caller, and — when the namespace is (or will be) shared —
 * redistributable by the caller (see sharing-rules.ts).
 */
async function validateNamespaceServers(
  principal: AccessPrincipal,
  serverUuids: string[],
  options: { namespaceIsShared: boolean; previousServerUuids?: string[] },
): Promise<
  { ok: true; servers: DatabaseMcpServer[] } | { ok: false; message: string }
> {
  const uniqueUuids = [...new Set(serverUuids)];
  const servers = await mcpServersRepository.findByUuids(uniqueUuids);
  const access = await accessService.resolveAccess(
    principal,
    "mcp_server",
    servers,
  );

  // Servers already in the namespace stay even if the caller cannot use
  // them (another editor added them); only new ones need the caller's access.
  const previous = new Set(options.previousServerUuids ?? []);
  if (
    servers.length !== uniqueUuids.length ||
    servers.some(
      (server) => !previous.has(server.uuid) && !access.get(server.uuid),
    )
  ) {
    return {
      ok: false,
      message: "One or more selected MCP servers could not be found",
    };
  }

  if (options.namespaceIsShared && !principal.isAdmin) {
    const added = servers.filter((server) => !previous.has(server.uuid));
    const everyone = await accessService.getEveryoneGroup();
    const grants = await resourceSharesRepository.findGrantsForResources(
      "mcp_server",
      added.map((server) => server.uuid),
    );
    const blocked = findNonRedistributableServers(
      principal,
      added.map((server) => ({
        uuid: server.uuid,
        name: server.name,
        access: access.get(server.uuid) ?? null,
        sharedWithEveryone: grants.some(
          (grant) =>
            grant.resourceUuid === server.uuid &&
            grant.groupUuid !== null &&
            grant.groupUuid === everyone?.uuid,
        ),
      })),
    );
    if (blocked.length > 0) {
      return { ok: false, message: describeRedistributionError(blocked) };
    }
    // Servers holding MetaMCP credentials redistribute what those reach
    for (const server of added) {
      const embedded = await checkEmbeddedCredentialRedistribution(
        principal,
        server,
      );
      if (embedded) return { ok: false, message: embedded };
    }
  }

  return { ok: true, servers };
}

/** Loads a namespace with the caller's access, enforcing a minimum level. */
async function loadNamespaceWithAccess(
  principal: AccessPrincipal,
  namespaceUuid: string,
  required: "use" | "edit" | "manage",
  action: string,
) {
  const namespace = await namespacesRepository.findByUuid(namespaceUuid);
  const access = namespace
    ? await accessService.resolveAccessOne(principal, "namespace", namespace)
    : null;
  if (!namespace || !access) {
    return { ok: false as const, message: notFoundMessage("Namespace") };
  }
  if (!hasLevel(access, required)) {
    return { ok: false as const, message: forbiddenMessage(action, required) };
  }
  return { ok: true as const, namespace, access };
}

const namespaceTarget = (namespace: { uuid: string; name: string }) => ({
  type: "namespace",
  id: namespace.uuid,
  label: namespace.name,
});

export const namespacesImplementations = {
  create: async (
    input: z.infer<typeof CreateNamespaceRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof CreateNamespaceResponseSchema>> => {
    try {
      if (!hasCapability(principal, "namespaces.create")) {
        return {
          success: false as const,
          message:
            "Access denied: your role does not allow creating namespaces.",
        };
      }

      const ownerDecision = decideOwnerForCreate(principal, input.user_id);
      if (!ownerDecision.ok) {
        return { success: false as const, message: ownerDecision.message };
      }
      const effectiveUserId = ownerDecision.ownerId;

      // Every server must be usable by the creator. A new namespace has no
      // shares yet, so redistribution rules apply only when it gets shared.
      if (input.mcpServerUuids && input.mcpServerUuids.length > 0) {
        const validation = await validateNamespaceServers(
          principal,
          input.mcpServerUuids,
          { namespaceIsShared: false },
        );
        if (!validation.ok) {
          return { success: false as const, message: validation.message };
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
          logger.info(
            `Ensured idle MetaMCP server exists for new namespace ${result.uuid}`,
          );
        })
        .catch((error) => {
          logger.error(
            `Error ensuring idle MetaMCP server for new namespace ${result.uuid}:`,
            error,
          );
          // Don't fail the entire create operation if idle server creation fails
        });

      await activityLog.record({
        actor: principal,
        action: "namespace.created",
        target: namespaceTarget(result),
        details: {
          servers: input.mcpServerUuids?.length ?? 0,
          owner: result.user_id ? "user" : "organisation",
        },
      });

      const [data] = await serializeNamespacesForPrincipal(principal, [result]);
      return {
        success: true as const,
        data: data ?? NamespacesSerializer.serializeNamespace(result),
        message: "Namespace created successfully",
      };
    } catch (error) {
      logger.error("Error creating namespace:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  list: async (
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof ListNamespacesResponseSchema>> => {
    try {
      // Namespaces the caller owns or that are shared with them (all for admins)
      const filter = await accessService.accessibleFilter(
        principal,
        "namespace",
      );
      const namespaces = await namespacesRepository.findAllByAccess(filter);

      return {
        success: true as const,
        data: await serializeNamespacesForPrincipal(principal, namespaces),
        message: "Namespaces retrieved successfully",
      };
    } catch (error) {
      logger.error("Error fetching namespaces:", error);
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
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof GetNamespaceResponseSchema>> => {
    try {
      const namespaceWithServers =
        await namespacesRepository.findByUuidWithServers(input.uuid);
      const [namespace] = namespaceWithServers
        ? await serializeNamespacesForPrincipal(principal, [
            namespaceWithServers,
          ])
        : [];

      if (!namespaceWithServers || !namespace) {
        return {
          success: false as const,
          message: notFoundMessage("Namespace"),
        };
      }

      // Server secrets are only visible to people who can edit that server;
      // using a namespace never reveals the credentials of its servers.
      const serverAccess = await accessService.resolveAccess(
        principal,
        "mcp_server",
        namespaceWithServers.servers,
      );
      const serialized =
        NamespacesSerializer.serializeNamespaceWithServers(
          namespaceWithServers,
        );

      return {
        success: true as const,
        data: {
          ...serialized,
          access: namespace.access,
          owner: namespace.owner,
          shareCount: namespace.shareCount,
          servers: serialized.servers.map((server) => {
            const access = serverAccess.get(server.uuid) ?? null;
            const withAccess = { ...server, access: access ?? undefined };
            return hasLevel(access, "edit")
              ? { ...withAccess, secretsRedacted: false }
              : redactServerSecrets(withAccess);
          }),
        },
        message: "Namespace retrieved successfully",
      };
    } catch (error) {
      logger.error("Error fetching namespace:", error);
      return {
        success: false as const,
        message: "Failed to fetch namespace",
      };
    }
  },

  getTools: async (
    input: z.infer<typeof GetNamespaceToolsRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof GetNamespaceToolsResponseSchema>> => {
    try {
      const loaded = await loadNamespaceWithAccess(
        principal,
        input.namespaceUuid,
        "use",
        "view this namespace",
      );
      if (!loaded.ok) {
        return { success: false as const, data: [], message: loaded.message };
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
      logger.error("Error fetching namespace tools:", error);
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
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof DeleteNamespaceResponseSchema>> => {
    try {
      const loaded = await loadNamespaceWithAccess(
        principal,
        input.uuid,
        "manage",
        "delete this namespace",
      );
      if (!loaded.ok) {
        return { success: false as const, message: loaded.message };
      }

      const deletedNamespace = await namespacesRepository.deleteByUuid(
        input.uuid,
      );
      endpointAccessCache.clear(); // owner / namespace may have changed

      if (!deletedNamespace) {
        return {
          success: false as const,
          message: "Namespace not found",
        };
      }

      // Clean up idle MetaMCP server for the deleted namespace
      try {
        await metaMcpServerPool.cleanupIdleServer(input.uuid);
        logger.info(
          `Cleaned up idle MetaMCP server for deleted namespace ${input.uuid}`,
        );
      } catch (error) {
        logger.error(
          `Error cleaning up idle MetaMCP server for deleted namespace ${input.uuid}:`,
          error,
        );
        // Don't fail the entire delete operation if idle server cleanup fails
      }

      // Clear the tool overrides cache for the deleted namespace
      clearOverrideCache(input.uuid);
      logger.info(
        `Cleared tool overrides cache for deleted namespace ${input.uuid}`,
      );

      await activityLog.record({
        actor: principal,
        action: "namespace.deleted",
        target: namespaceTarget(deletedNamespace),
      });

      return {
        success: true as const,
        message: "Namespace deleted successfully",
      };
    } catch (error) {
      logger.error("Error deleting namespace:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  update: async (
    input: z.infer<typeof UpdateNamespaceRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof UpdateNamespaceResponseSchema>> => {
    try {
      const loaded = await loadNamespaceWithAccess(
        principal,
        input.uuid,
        "edit",
        "edit this namespace",
      );
      if (!loaded.ok) {
        return { success: false as const, message: loaded.message };
      }
      const existingNamespace = loaded.namespace;
      // Servers before the update, for the activity log.
      const previousServerUuids =
        (
          await namespacesRepository.findByUuidWithServers(input.uuid)
        )?.servers.map((server) => server.uuid) ?? [];

      const ownerDecision = decideOwnerForUpdate(
        principal,
        existingNamespace.user_id,
        input.user_id,
      );
      if (!ownerDecision.ok) {
        return { success: false as const, message: ownerDecision.message };
      }

      if (input.mcpServerUuids && input.mcpServerUuids.length > 0) {
        const [existingWithServers, shareCounts, endpoints] = await Promise.all(
          [
            namespacesRepository.findByUuidWithServers(input.uuid),
            resourceSharesRepository.countForResources("namespace", [
              input.uuid,
            ]),
            endpointsRepository.findByNamespaceUuid(input.uuid),
          ],
        );
        // An endpoint without authentication publishes the namespace to
        // anyone: it counts as sharing it.
        const hasOpenEndpoint = endpoints.some(
          (endpoint) => !endpoint.enable_api_key_auth && !endpoint.enable_oauth,
        );
        const validation = await validateNamespaceServers(
          principal,
          input.mcpServerUuids,
          {
            namespaceIsShared:
              (shareCounts.get(input.uuid) ?? 0) > 0 || hasOpenEndpoint,
            previousServerUuids:
              existingWithServers?.servers.map((server) => server.uuid) ?? [],
          },
        );
        if (!validation.ok) {
          return { success: false as const, message: validation.message };
        }
      }

      const result = await namespacesRepository.update({
        uuid: input.uuid,
        name: input.name,
        description: input.description,
        user_id: ownerDecision.ownerId,
        mcpServerUuids: input.mcpServerUuids,
      });
      endpointAccessCache.clear(); // owner / namespace may have changed

      // Invalidate idle MetaMCP server for this namespace since the MCP servers list may have changed
      // Run this asynchronously to avoid blocking the response
      metaMcpServerPool
        .invalidateIdleServer(input.uuid)
        .then(() => {
          logger.info(
            `Invalidated idle MetaMCP server for updated namespace ${input.uuid}`,
          );
        })
        .catch((error) => {
          logger.error(
            `Error invalidating idle MetaMCP server for namespace ${input.uuid}:`,
            error,
          );
          // Don't fail the entire update operation if idle server invalidation fails
        });

      // Also invalidate OpenAPI sessions for this namespace
      metaMcpServerPool
        .invalidateOpenApiSessions([input.uuid])
        .then(() => {
          logger.info(
            `Invalidated OpenAPI session for updated namespace ${input.uuid}`,
          );
        })
        .catch((error) => {
          logger.error(
            `Error invalidating OpenAPI session for namespace ${input.uuid}:`,
            error,
          );
          // Don't fail the entire update operation if OpenAPI session invalidation fails
        });

      // Clear tool overrides cache for this namespace since MCP servers list may have changed
      clearOverrideCache(input.uuid);
      logger.info(
        `Cleared tool overrides cache for updated namespace ${input.uuid}`,
      );

      const before = loaded.namespace;
      const beforeServers = previousServerUuids;
      const changedFields = [
        ...(input.name !== undefined && input.name !== before.name
          ? ["name"]
          : []),
        ...(input.description !== undefined &&
        (input.description ?? null) !== (before.description ?? null)
          ? ["description"]
          : []),
        ...(result.user_id !== before.user_id ? ["owner"] : []),
      ];
      const nextServers = input.mcpServerUuids ?? beforeServers;
      const addedServers = nextServers.filter(
        (uuid) => !beforeServers.includes(uuid),
      );
      const removedServers = beforeServers.filter(
        (uuid) => !nextServers.includes(uuid),
      );
      if (
        changedFields.length > 0 ||
        addedServers.length > 0 ||
        removedServers.length > 0
      ) {
        await activityLog.record({
          actor: principal,
          action: "namespace.updated",
          target: namespaceTarget(result),
          details: {
            ...(changedFields.length > 0 ? { changedFields } : {}),
            ...(addedServers.length > 0 ? { serversAdded: addedServers } : {}),
            ...(removedServers.length > 0
              ? { serversRemoved: removedServers }
              : {}),
          },
        });
      }

      const [data] = await serializeNamespacesForPrincipal(principal, [result]);
      return {
        success: true as const,
        data: data ?? NamespacesSerializer.serializeNamespace(result),
        message: "Namespace updated successfully",
      };
    } catch (error) {
      logger.error("Error updating namespace:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  updateServerStatus: async (
    input: z.infer<typeof UpdateNamespaceServerStatusRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof UpdateNamespaceServerStatusResponseSchema>> => {
    try {
      // First, check if user has permission to update this namespace
      const loaded = await loadNamespaceWithAccess(
        principal,
        input.namespaceUuid,
        "edit",
        "change server status in this namespace",
      );
      if (!loaded.ok) {
        return { success: false as const, message: loaded.message };
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
          logger.info(
            `Invalidated idle MetaMCP server for namespace ${input.namespaceUuid} after server status update`,
          );
        })
        .catch((error) => {
          logger.error(
            `Error invalidating idle MetaMCP server for namespace ${input.namespaceUuid}:`,
            error,
          );
          // Don't fail the entire operation if idle server invalidation fails
        });

      // Also invalidate OpenAPI sessions for this namespace
      metaMcpServerPool
        .invalidateOpenApiSessions([input.namespaceUuid])
        .then(() => {
          logger.info(
            `Invalidated OpenAPI session for namespace ${input.namespaceUuid} after server status update`,
          );
        })
        .catch((error) => {
          logger.error(
            `Error invalidating OpenAPI session for namespace ${input.namespaceUuid}:`,
            error,
          );
          // Don't fail the entire operation if OpenAPI session invalidation fails
        });

      await activityLog.record({
        actor: principal,
        action: "namespace.updated",
        target: namespaceTarget(loaded.namespace),
        details: {
          server: input.serverUuid,
          serverStatus: input.status,
        },
      });

      return {
        success: true as const,
        message: "Server status updated successfully",
      };
    } catch (error) {
      logger.error("Error updating server status:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  updateToolStatus: async (
    input: z.infer<typeof UpdateNamespaceToolStatusRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof UpdateNamespaceToolStatusResponseSchema>> => {
    try {
      // First, check if user has permission to update this namespace
      const loaded = await loadNamespaceWithAccess(
        principal,
        input.namespaceUuid,
        "edit",
        "change tool status in this namespace",
      );
      if (!loaded.ok) {
        return { success: false as const, message: loaded.message };
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

      const tool = await toolsRepository.findByUuid(input.toolUuid);
      await activityLog.record({
        actor: principal,
        action: "namespace.updated",
        target: namespaceTarget(loaded.namespace),
        details: {
          tool: tool?.name ?? input.toolUuid,
          toolStatus: input.status,
        },
      });

      return {
        success: true as const,
        message: "Tool status updated successfully",
      };
    } catch (error) {
      logger.error("Error updating tool status:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  updateToolOverrides: async (
    input: z.infer<typeof UpdateNamespaceToolOverridesRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof UpdateNamespaceToolOverridesResponseSchema>> => {
    try {
      // First, check if user has permission to update this namespace
      const loaded = await loadNamespaceWithAccess(
        principal,
        input.namespaceUuid,
        "edit",
        "change tool overrides in this namespace",
      );
      if (!loaded.ok) {
        return { success: false as const, message: loaded.message };
      }

      const updatedMapping =
        await namespaceMappingsRepository.updateToolOverrides({
          namespaceUuid: input.namespaceUuid,
          toolUuid: input.toolUuid,
          serverUuid: input.serverUuid,
          overrideName: input.overrideName,
          overrideTitle: input.overrideTitle,
          overrideDescription: input.overrideDescription,
          overrideAnnotations: input.overrideAnnotations,
        });

      if (!updatedMapping) {
        return {
          success: false as const,
          message: "Tool not found in namespace",
        };
      }

      // Clear the tool overrides cache for this namespace to ensure fresh data is loaded
      clearOverrideCache(input.namespaceUuid);
      logger.info(
        `Cleared tool overrides cache for namespace ${input.namespaceUuid} after updating tool overrides`,
      );

      const overriddenTool = await toolsRepository.findByUuid(input.toolUuid);
      await activityLog.record({
        actor: principal,
        action: "namespace.updated",
        target: namespaceTarget(loaded.namespace),
        details: {
          tool: overriddenTool?.name ?? input.toolUuid,
          toolOverrides: [
            ...(input.overrideName !== undefined ? ["name"] : []),
            ...(input.overrideTitle !== undefined ? ["title"] : []),
            ...(input.overrideDescription !== undefined ? ["description"] : []),
            ...(input.overrideAnnotations !== undefined ? ["annotations"] : []),
          ],
        },
      });

      return {
        success: true as const,
        message: "Tool overrides updated successfully",
      };
    } catch (error) {
      logger.error("Error updating tool overrides:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  refreshTools: async (
    input: z.infer<typeof RefreshNamespaceToolsRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof RefreshNamespaceToolsResponseSchema>> => {
    try {
      // First, check if user has permission to refresh tools for this namespace
      const loaded = await loadNamespaceWithAccess(
        principal,
        input.namespaceUuid,
        "edit",
        "refresh tools of this namespace",
      );
      if (!loaded.ok) {
        return { success: false as const, message: loaded.message };
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
      // Important: The input tools may have overridden names applied by MetaMCP middleware
      // We need to map them back to original names to avoid overwriting original names in the database
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
          logger.warn(
            `Tool name "${tool.name}" does not contain "__" separator, skipping`,
          );
          continue;
        }

        const serverName = tool.name.substring(0, lastDoubleUnderscoreIndex);
        const toolName = tool.name.substring(lastDoubleUnderscoreIndex + 2);

        // Check if this tool name might be an override name by looking up the original name
        // If it is an override name, skip this tool entirely to avoid duplicates
        try {
          const fullToolName = `${serverName}__${toolName}`;
          const originalToolName = await mapOverrideNameToOriginal(
            fullToolName,
            input.namespaceUuid,
          );

          // If we found an original name mapping, this means the current toolName is an override
          // Skip this tool to avoid creating duplicates
          if (originalToolName !== fullToolName) {
            logger.info(
              `Skipping override tool "${fullToolName}" as it maps to original "${originalToolName}"`,
            );
            continue;
          }
        } catch (error) {
          // If mapping fails, continue with the parsed name (it's likely an original tool)
          logger.warn(
            `Failed to map override name for tool "${toolName}":`,
            error,
          );
        }

        if (!serverName || !toolName) {
          logger.warn(`Invalid tool name format "${tool.name}", skipping`);
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

      // Only servers that belong to this namespace can receive tools, and
      // tool definitions (shared by every namespace using the server) are
      // only written for servers the caller may edit. For other servers we
      // only map tools that already exist, so a namespace editor cannot
      // rewrite the tool descriptions another server's owner published.
      const namespaceWithServers =
        await namespacesRepository.findByUuidWithServers(input.namespaceUuid);
      const serversInNamespace = new Map(
        (namespaceWithServers?.servers ?? []).map((server) => [
          server.name,
          server,
        ]),
      );
      const serverAccess = await accessService.resolveAccess(
        principal,
        "mcp_server",
        namespaceWithServers?.servers ?? [],
      );
      const findServerByName = async (name: string) =>
        serversInNamespace.get(name);

      for (const parsedTool of parsedTools) {
        // Find server by name - first try exact match
        let server = await findServerByName(parsedTool.serverName);

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

          server = await findServerByName(actualServerName);

          if (server) {
            logger.info(
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
          logger.warn(
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
        const canEditServer = hasLevel(serverAccess.get(serverUuid), "edit");

        // Bulk upsert tools to the tools table with the actual tool names
        // (or, without edit access on the server, reuse the existing rows)
        const upsertedTools = canEditServer
          ? await toolsRepository.bulkUpsert({
              mcpServerUuid: serverUuid,
              tools: tools.map((tool) => ({
                name: tool.toolName, // Use the actual tool name, not the prefixed name
                description: tool.description,
                inputSchema: tool.inputSchema,
              })),
            })
          : (await toolsRepository.findByMcpServerUuid(serverUuid)).filter(
              (existing) =>
                tools.some((tool) => tool.toolName === existing.name),
            );

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

        logger.info(
          `Processed ${tools.length} tools for server "${serverName}" (${serverUuid})`,
        );
      }

      // Invalidate idle MetaMCP server for this namespace since tools were refreshed
      // Run this asynchronously to avoid blocking the response
      metaMcpServerPool
        .invalidateIdleServer(input.namespaceUuid)
        .then(() => {
          logger.info(
            `Invalidated idle MetaMCP server for namespace ${input.namespaceUuid} after tools refresh`,
          );
        })
        .catch((error) => {
          logger.error(
            `Error invalidating idle MetaMCP server for namespace ${input.namespaceUuid}:`,
            error,
          );
          // Don't fail the entire operation if idle server invalidation fails
        });

      // Also invalidate OpenAPI sessions for this namespace
      metaMcpServerPool
        .invalidateOpenApiSessions([input.namespaceUuid])
        .then(() => {
          logger.info(
            `Invalidated OpenAPI session for namespace ${input.namespaceUuid} after tools refresh`,
          );
        })
        .catch((error) => {
          logger.error(
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
      logger.error("Error refreshing namespace tools:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },
};
