import { randomBytes } from "node:crypto";

import {
  type AccessPrincipal,
  CreateEndpointRequestSchema,
  CreateEndpointResponseSchema,
  type DatabaseEndpoint,
  type DatabaseEndpointWithNamespace,
  DeleteEndpointResponseSchema,
  type EndpointWithNamespace,
  GetEndpointResponseSchema,
  ListEndpointsResponseSchema,
  type ResourceAccess,
  UpdateEndpointRequestSchema,
  UpdateEndpointResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import {
  ApiKeysRepository,
  endpointsRepository,
  mcpServersRepository,
  namespacesRepository,
} from "../db/repositories";
import { EndpointsSerializer } from "../db/serializers";
import { accessService } from "../lib/access/access.service";
import { endpointAccessCache } from "../lib/access/endpoint-access-cache";
import { loadOwners } from "../lib/access/owners";
import { hasCapability } from "../lib/access/policy";
import {
  decideOwnerForCreate,
  decideOwnerForUpdate,
  forbiddenMessage,
  hasLevel,
  notFoundMessage,
} from "../lib/access/resource-guards";
import { activityLog, diffFields } from "../lib/activity/activity-log.service";
import { publicErrorMessage } from "../lib/errors";

const apiKeysRepository = new ApiKeysRepository();

const UNAUTHENTICATED_ENDPOINT_MESSAGE =
  "Only administrators can publish an endpoint without authentication: it would expose the namespace to anyone who can reach MetaMCP.";
const ADMIN_TOOLS_MESSAGE =
  "Only administrators can enable the MetaMCP admin tools on an endpoint.";

/**
 * Access to an endpoint derives from its namespace: whoever can use the
 * namespace can use (and see) its endpoints, and managing an endpoint requires
 * owning it or managing its namespace. Administrators manage the
 * organisation's endpoints.
 */
function endpointAccess(
  principal: AccessPrincipal,
  endpoint: Pick<DatabaseEndpoint, "user_id">,
  namespaceAccess: ResourceAccess | null,
): ResourceAccess | null {
  if (endpoint.user_id !== null && endpoint.user_id === principal.userId) {
    return { level: "manage", reason: "owner" };
  }
  if (endpoint.user_id === null && principal.isAdmin) {
    return { level: "manage", reason: "admin" };
  }
  if (!namespaceAccess) return null;
  return {
    level: namespaceAccess.level === "manage" ? "manage" : "use",
    reason: namespaceAccess.reason,
  };
}

async function serializeEndpointsForPrincipal(
  principal: AccessPrincipal,
  endpoints: DatabaseEndpointWithNamespace[],
): Promise<EndpointWithNamespace[]> {
  const [namespaceAccess, owners] = await Promise.all([
    accessService.resolveAccess(
      principal,
      "namespace",
      endpoints.map((endpoint) => endpoint.namespace),
    ),
    loadOwners(endpoints.map((endpoint) => endpoint.user_id)),
  ]);

  return endpoints.flatMap((endpoint) => {
    const access = endpointAccess(
      principal,
      endpoint,
      namespaceAccess.get(endpoint.namespace.uuid) ?? null,
    );
    if (!access) return [];
    return [
      {
        ...EndpointsSerializer.serializeEndpointWithNamespace(endpoint),
        access,
        owner: endpoint.user_id ? (owners.get(endpoint.user_id) ?? null) : null,
      },
    ];
  });
}

/** Namespace an endpoint may point to: the caller must manage it. */
async function checkTargetNamespace(
  principal: AccessPrincipal,
  namespaceUuid: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const namespace = await namespacesRepository.findByUuid(namespaceUuid);
  const access = namespace
    ? await accessService.resolveAccessOne(principal, "namespace", namespace)
    : null;
  if (!namespace || !access) {
    return { ok: false, message: "Selected namespace could not be found" };
  }
  if (!hasLevel(access, "manage")) {
    return {
      ok: false,
      message: `Access denied: you need "manage" permission on namespace "${namespace.name}" to publish it through an endpoint.`,
    };
  }
  return { ok: true };
}

export const endpointsImplementations = {
  create: async (
    input: z.infer<typeof CreateEndpointRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof CreateEndpointResponseSchema>> => {
    try {
      if (!hasCapability(principal, "endpoints.create")) {
        return {
          success: false as const,
          message:
            "Access denied: your role does not allow creating endpoints.",
        };
      }

      const enableApiKeyAuth = input.enableApiKeyAuth ?? true;
      const enableOauth = input.enableOauth ?? false;
      if (!principal.isAdmin && !enableApiKeyAuth && !enableOauth) {
        return {
          success: false as const,
          message: UNAUTHENTICATED_ENDPOINT_MESSAGE,
        };
      }
      if (!principal.isAdmin && input.enableMetamcpAdminTools) {
        return { success: false as const, message: ADMIN_TOOLS_MESSAGE };
      }

      // Check if endpoint name already exists (must be globally unique)
      const existingEndpoint = await endpointsRepository.findByName(input.name);
      if (existingEndpoint) {
        return {
          success: false as const,
          message: "Endpoint name already exists",
        };
      }

      const ownerDecision = decideOwnerForCreate(principal, input.user_id);
      if (!ownerDecision.ok) {
        return { success: false as const, message: ownerDecision.message };
      }
      const effectiveUserId = ownerDecision.ownerId;

      const namespaceCheck = await checkTargetNamespace(
        principal,
        input.namespaceUuid,
      );
      if (!namespaceCheck.ok) {
        return { success: false as const, message: namespaceCheck.message };
      }

      const result = await endpointsRepository.create({
        name: input.name,
        description: input.description,
        namespace_uuid: input.namespaceUuid,
        enable_api_key_auth: enableApiKeyAuth,
        enable_max_rate: input.enableMaxRate ?? false,
        enable_client_max_rate: input.enableClientMaxRate ?? false,
        max_rate: input.maxRate,
        max_rate_seconds: input.maxRateSeconds,
        client_max_rate: input.clientMaxRate,
        client_max_rate_seconds: input.clientMaxRateSeconds,
        client_max_rate_strategy: input.clientMaxRateStrategy,
        client_max_rate_strategy_key: input.clientMaxRateStrategyKey,
        enable_oauth: enableOauth,
        use_query_param_auth: input.useQueryParamAuth ?? false,
        enable_metamcp_admin_tools: input.enableMetamcpAdminTools ?? false,
        user_id: effectiveUserId,
      });

      // Create MCP server if requested
      if (input.createMcpServer) {
        if (!hasCapability(principal, "mcp_servers.create")) {
          logger.warn(
            `Skipping MCP server creation for endpoint ${input.name}: caller cannot add MCP servers`,
          );
        } else {
          try {
            const mcpServerName = `${input.name}-endpoint`;
            const mcpServerDescription = `Auto-generated MCP server for endpoint "${input.name}"`;

            const baseUrl = process.env.APP_URL;
            const endpointUrl = `${baseUrl}/metamcp/${input.name}/mcp`;

            // A dedicated API key authenticates the generated server (only
            // when API key auth is enabled). It is limited to this endpoint
            // and to MCP traffic (no admin tools), and belongs to the owner
            // of the server: anyone who can edit the server can read it, so
            // it must never be a full personal key of the creator (possibly
            // an administrator). Existing keys cannot be reused: MetaMCP only
            // keeps their digest. It can be revoked on its own.
            let bearerToken = "";
            if (
              enableApiKeyAuth &&
              !hasCapability(principal, "api_keys.create")
            ) {
              logger.warn(
                `Generated server of endpoint ${input.name} has no API key: the caller cannot create API keys`,
              );
            } else if (enableApiKeyAuth) {
              try {
                const newApiKey = await apiKeysRepository.create({
                  // Suffix: key names are unique per user, endpoints can be
                  // deleted and recreated with the same name.
                  name:
                    `endpoint-${input.name}`.slice(0, 90) +
                    `-${randomBytes(3).toString("hex")}`,
                  user_id: effectiveUserId,
                  is_active: true,
                  scope: "endpoints",
                  endpoint_uuids: [result.uuid],
                });
                bearerToken = newApiKey.key;
              } catch (apiKeyError) {
                logger.error(
                  "Error getting API key for MCP server:",
                  apiKeyError,
                );
                // Continue without bearer token if API key operation fails
              }
            }

            await mcpServersRepository.create({
              name: mcpServerName,
              description: mcpServerDescription,
              type: "STREAMABLE_HTTP",
              url: endpointUrl,
              bearerToken: bearerToken,
              command: "",
              args: [],
              env: {},
              user_id: effectiveUserId,
            });
          } catch (mcpError) {
            logger.error("Error creating MCP server:", mcpError);
            // Don't fail the endpoint creation if MCP server creation fails
            // Just log the error and continue
          }
        }
      }

      await activityLog.record({
        actor: principal,
        action: "endpoint.created",
        target: { type: "endpoint", id: result.uuid, label: result.name },
        details: {
          namespace: input.namespaceUuid,
          apiKeyAuth: enableApiKeyAuth,
          oauth: enableOauth,
          adminTools: input.enableMetamcpAdminTools ?? false,
        },
      });

      return {
        success: true as const,
        data: EndpointsSerializer.serializeEndpoint(result),
        message: "Endpoint created successfully",
      };
    } catch (error) {
      logger.error("Error creating endpoint:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  list: async (
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof ListEndpointsResponseSchema>> => {
    try {
      // Own endpoints + endpoints of every namespace the caller can use
      const namespaceFilter = await accessService.accessibleFilter(
        principal,
        "namespace",
      );
      const endpoints =
        await endpointsRepository.findAllWithNamespacesByAccess(
          namespaceFilter,
        );

      return {
        success: true as const,
        data: await serializeEndpointsForPrincipal(principal, endpoints),
        message: "Endpoints retrieved successfully",
      };
    } catch (error) {
      logger.error("Error fetching endpoints:", error);
      return {
        success: false as const,
        data: [],
        message: "Failed to fetch endpoints",
      };
    }
  },

  get: async (
    input: {
      uuid: string;
    },
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof GetEndpointResponseSchema>> => {
    try {
      const endpoint = await endpointsRepository.findByUuidWithNamespace(
        input.uuid,
      );
      const [data] = endpoint
        ? await serializeEndpointsForPrincipal(principal, [endpoint])
        : [];

      if (!data) {
        return {
          success: false as const,
          message: notFoundMessage("Endpoint"),
        };
      }

      return {
        success: true as const,
        data,
        message: "Endpoint retrieved successfully",
      };
    } catch (error) {
      logger.error("Error fetching endpoint:", error);
      return {
        success: false as const,
        message: "Failed to fetch endpoint",
      };
    }
  },

  delete: async (
    input: {
      uuid: string;
    },
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof DeleteEndpointResponseSchema>> => {
    try {
      const existingEndpoint =
        await endpointsRepository.findByUuidWithNamespace(input.uuid);
      const [visible] = existingEndpoint
        ? await serializeEndpointsForPrincipal(principal, [existingEndpoint])
        : [];

      if (!existingEndpoint || !visible?.access) {
        return {
          success: false as const,
          message: notFoundMessage("Endpoint"),
        };
      }

      if (!hasLevel(visible.access, "manage")) {
        return {
          success: false as const,
          message: forbiddenMessage("delete this endpoint", "manage"),
        };
      }

      const deletedEndpoint = await endpointsRepository.deleteByUuid(
        input.uuid,
      );
      endpointAccessCache.clear(); // owner / namespace may have changed

      if (!deletedEndpoint) {
        return {
          success: false as const,
          message: "Endpoint not found",
        };
      }

      await activityLog.record({
        actor: principal,
        action: "endpoint.deleted",
        target: {
          type: "endpoint",
          id: existingEndpoint.uuid,
          label: existingEndpoint.name,
        },
      });

      return {
        success: true as const,
        message: "Endpoint deleted successfully",
      };
    } catch (error) {
      logger.error("Error deleting endpoint:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  update: async (
    input: z.infer<typeof UpdateEndpointRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof UpdateEndpointResponseSchema>> => {
    try {
      const existingEndpoint =
        await endpointsRepository.findByUuidWithNamespace(input.uuid);
      const [visible] = existingEndpoint
        ? await serializeEndpointsForPrincipal(principal, [existingEndpoint])
        : [];

      if (!existingEndpoint || !visible?.access) {
        return {
          success: false as const,
          message: notFoundMessage("Endpoint"),
        };
      }

      if (!hasLevel(visible.access, "manage")) {
        return {
          success: false as const,
          message: forbiddenMessage("edit this endpoint", "manage"),
        };
      }

      if (!principal.isAdmin) {
        const nextApiKeyAuth =
          input.enableApiKeyAuth ?? existingEndpoint.enable_api_key_auth;
        const nextOauth = input.enableOauth ?? existingEndpoint.enable_oauth;
        const wasOpen =
          !existingEndpoint.enable_api_key_auth &&
          !existingEndpoint.enable_oauth;
        if (!nextApiKeyAuth && !nextOauth && !wasOpen) {
          return {
            success: false as const,
            message: UNAUTHENTICATED_ENDPOINT_MESSAGE,
          };
        }
        // An open endpoint published by an administrator must not be
        // re-pointed at another namespace, which would publish that one.
        if (
          !nextApiKeyAuth &&
          !nextOauth &&
          input.namespaceUuid !== existingEndpoint.namespace_uuid
        ) {
          return {
            success: false as const,
            message: UNAUTHENTICATED_ENDPOINT_MESSAGE,
          };
        }
        if (
          input.enableMetamcpAdminTools &&
          !existingEndpoint.enable_metamcp_admin_tools
        ) {
          return { success: false as const, message: ADMIN_TOOLS_MESSAGE };
        }
      }

      const ownerDecision = decideOwnerForUpdate(
        principal,
        existingEndpoint.user_id,
        input.user_id,
      );
      if (!ownerDecision.ok) {
        return { success: false as const, message: ownerDecision.message };
      }

      // Re-pointing the endpoint requires managing the new namespace
      if (input.namespaceUuid !== existingEndpoint.namespace_uuid) {
        const namespaceCheck = await checkTargetNamespace(
          principal,
          input.namespaceUuid,
        );
        if (!namespaceCheck.ok) {
          return { success: false as const, message: namespaceCheck.message };
        }
      }

      // Check if another endpoint with the same name exists (excluding current one)
      const duplicateEndpoint = await endpointsRepository.findByName(
        input.name,
      );
      if (duplicateEndpoint && duplicateEndpoint.uuid !== input.uuid) {
        return {
          success: false as const,
          message: "Endpoint name already exists",
        };
      }

      const result = await endpointsRepository.update({
        uuid: input.uuid,
        name: input.name,
        description: input.description,
        namespace_uuid: input.namespaceUuid,
        enable_api_key_auth: input.enableApiKeyAuth,
        enable_max_rate: input.enableMaxRate ?? false,
        enable_client_max_rate: input.enableClientMaxRate ?? false,
        max_rate: input.maxRate,
        max_rate_seconds: input.maxRateSeconds,
        client_max_rate: input.clientMaxRate,
        client_max_rate_seconds: input.clientMaxRateSeconds,
        client_max_rate_strategy: input.clientMaxRateStrategy,
        client_max_rate_strategy_key: input.clientMaxRateStrategyKey,
        enable_oauth: input.enableOauth,
        use_query_param_auth: input.useQueryParamAuth,
        enable_metamcp_admin_tools: input.enableMetamcpAdminTools,
        user_id: ownerDecision.ownerId,
      });
      endpointAccessCache.clear(); // owner / namespace may have changed

      // Authentication switches are security relevant: keep before/after.
      const changes = diffFields(
        existingEndpoint as unknown as Record<string, unknown>,
        result as unknown as Record<string, unknown>,
        [
          "name",
          "description",
          "namespace_uuid",
          "enable_api_key_auth",
          "enable_oauth",
          "use_query_param_auth",
          "enable_metamcp_admin_tools",
          "enable_max_rate",
          "max_rate",
          "enable_client_max_rate",
          "client_max_rate",
          "user_id",
        ],
      );
      if (Object.keys(changes).length > 0) {
        await activityLog.record({
          actor: principal,
          action: "endpoint.updated",
          target: { type: "endpoint", id: result.uuid, label: result.name },
          details: { changes },
        });
      }

      return {
        success: true as const,
        data: EndpointsSerializer.serializeEndpoint(result),
        message: "Endpoint updated successfully",
      };
    } catch (error) {
      logger.error("Error updating endpoint:", error);
      return {
        success: false as const,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },
};
