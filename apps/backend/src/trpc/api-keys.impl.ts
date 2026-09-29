import {
  type AccessPrincipal,
  type ApiKeyScope,
  CreateApiKeyRequestSchema,
  CreateApiKeyResponseSchema,
  DeleteApiKeyRequestSchema,
  DeleteApiKeyResponseSchema,
  type ListApiKeysRequest,
  ListApiKeysResponseSchema,
  UpdateApiKeyRequestSchema,
  UpdateApiKeyResponseSchema,
  ValidateApiKeyRequestSchema,
  ValidateApiKeyResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import { ApiKeysRepository, endpointsRepository } from "../db/repositories";
import type { ApiKeyManagementScope } from "../db/repositories/api-keys.repo";
import { ApiKeysSerializer } from "../db/serializers";
import { accessService } from "../lib/access/access.service";
import { endpointAccessCache } from "../lib/access/endpoint-access-cache";
import { hasCapability } from "../lib/access/policy";
import { activityLog } from "../lib/activity/activity-log.service";
import { publicErrorMessage } from "../lib/errors";

const apiKeysRepository = new ApiKeysRepository();

/** Keys a caller may manage: own ones; administrators also every other. */
function managementScope(principal: AccessPrincipal): ApiKeyManagementScope {
  return {
    userId: principal.userId,
    organization: principal.isAdmin,
    anyUser: principal.isAdmin,
  };
}

/**
 * Checks the endpoints an endpoint-scoped key is limited to: they must exist
 * and, for a personal key, be reachable by its owner (use access to their
 * namespace). Organisation keys are created by administrators, who may
 * dedicate one to any endpoint. Returns an error message, or null.
 */
async function checkScopeEndpoints(
  scope: ApiKeyScope,
  endpointUuids: string[] | undefined,
  ownerId: string | null,
): Promise<string | null> {
  if (scope !== "endpoints") return null;
  const uuids = [...new Set(endpointUuids ?? [])];
  if (uuids.length === 0) {
    return "Select at least one endpoint for an endpoint-scoped key.";
  }
  const endpoints =
    await endpointsRepository.findByUuidsWithNamespaceOwner(uuids);
  if (endpoints.length !== uuids.length) {
    return "One or more selected endpoints could not be found.";
  }
  if (ownerId === null) return null;

  const owner = await accessService.getPrincipal(ownerId);
  if (!owner) {
    return "The owner of this key is disabled.";
  }
  const access = await accessService.resolveAccess(
    owner,
    "namespace",
    endpoints.map((endpoint) => endpoint.namespace),
  );
  const unreachable = endpoints.filter(
    (endpoint) => !access.get(endpoint.namespace.uuid),
  );
  return unreachable.length === 0
    ? null
    : `The key owner cannot use these endpoints: ${unreachable
        .map((endpoint) => endpoint.name)
        .join(", ")}.`;
}

export const apiKeysImplementations = {
  create: async (
    input: z.input<typeof CreateApiKeyRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof CreateApiKeyResponseSchema>> => {
    const scope = input.scope ?? "user";
    if (!hasCapability(principal, "api_keys.create")) {
      throw new Error(
        "Access denied: your role does not allow creating API keys.",
      );
    }
    // API keys are personal credentials. Organisation keys (user_id NULL, not
    // tied to anyone) can only be created by administrators, and nobody can
    // mint a key for another user.
    if (input.user_id !== undefined && input.user_id !== principal.userId) {
      if (input.user_id !== null || !principal.isAdmin) {
        throw new Error(
          input.user_id === null
            ? "Only administrators can create organisation API keys."
            : "You can only create API keys for yourself.",
        );
      }
    }
    const apiKeyUserId = input.user_id === null ? null : principal.userId;
    const scopeError = await checkScopeEndpoints(
      scope,
      input.endpoint_uuids,
      apiKeyUserId,
    );
    if (scopeError) {
      throw new Error(scopeError);
    }
    try {
      const result = await apiKeysRepository.create({
        name: input.name,
        user_id: apiKeyUserId,
        is_active: true,
        scope,
        endpoint_uuids:
          scope === "endpoints" ? input.endpoint_uuids : undefined,
      });
      await activityLog.record({
        actor: principal,
        action: "api_key.created",
        target: { type: "api_key", id: result.uuid, label: result.name },
        details: {
          preview: result.key_preview,
          owner: result.user_id ? "user" : "organisation",
          scope: result.scope,
          ...(result.scope === "endpoints"
            ? { endpoints: input.endpoint_uuids?.length ?? 0 }
            : {}),
        },
      });

      return ApiKeysSerializer.serializeCreateApiKeyResponse(result);
    } catch (error) {
      logger.error("Error creating API key:", error);
      throw new Error(publicErrorMessage(error, "Internal server error"));
    }
  },

  list: async (
    principal: AccessPrincipal,
    input?: ListApiKeysRequest,
  ): Promise<z.infer<typeof ListApiKeysResponseSchema>> => {
    try {
      // Everyone sees their own keys (administrators also organisation
      // keys); administrators can ask for the keys of every user.
      const apiKeys = await apiKeysRepository.list({
        userId: principal.userId,
        organization: principal.isAdmin,
        anyUser: principal.isAdmin && input?.allUsers === true,
      });
      return { apiKeys };
    } catch (error) {
      logger.error("Error fetching API keys:", error);
      throw new Error("Failed to fetch API keys");
    }
  },

  update: async (
    input: z.infer<typeof UpdateApiKeyRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof UpdateApiKeyResponseSchema>> => {
    const scope = managementScope(principal);
    const existing = await apiKeysRepository.findManageable(input.uuid, scope);
    if (!existing) {
      throw new Error("Failed to update API key or API key not found");
    }
    const nextScope = input.scope ?? existing.scope;
    if (input.scope !== undefined || input.endpoint_uuids !== undefined) {
      if (nextScope === "endpoints" && input.endpoint_uuids === undefined) {
        throw new Error(
          "Select at least one endpoint for an endpoint-scoped key.",
        );
      }
      const scopeError = await checkScopeEndpoints(
        nextScope,
        input.endpoint_uuids,
        existing.user_id,
      );
      if (scopeError) {
        throw new Error(scopeError);
      }
    }
    try {
      const result = await apiKeysRepository.update(input.uuid, scope, {
        name: input.name,
        is_active: input.is_active,
        scope: input.scope,
        endpoint_uuids:
          nextScope === "endpoints" ? input.endpoint_uuids : undefined,
      });
      // Cached access decisions may involve this key
      endpointAccessCache.clear();

      await activityLog.record({
        actor: principal,
        action: "api_key.updated",
        target: { type: "api_key", id: result.uuid, label: result.name },
        details: {
          preview: result.key_preview,
          ...(existing.user_id !== principal.userId
            ? { owner: existing.user_id ? "other user" : "organisation" }
            : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.is_active !== undefined ? { active: input.is_active } : {}),
          ...(input.scope !== undefined || input.endpoint_uuids !== undefined
            ? {
                scope: result.scope,
                ...(result.scope === "endpoints"
                  ? { endpoints: input.endpoint_uuids?.length ?? 0 }
                  : {}),
              }
            : {}),
        },
      });

      return ApiKeysSerializer.serializeApiKey(result);
    } catch (error) {
      logger.error("Error updating API key:", error);
      throw new Error(publicErrorMessage(error, "Internal server error"));
    }
  },

  delete: async (
    input: z.infer<typeof DeleteApiKeyRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof DeleteApiKeyResponseSchema>> => {
    try {
      const deleted = await apiKeysRepository.delete(
        input.uuid,
        managementScope(principal),
      );
      endpointAccessCache.clear();
      await activityLog.record({
        actor: principal,
        action: "api_key.deleted",
        target: { type: "api_key", id: deleted.uuid, label: deleted.name },
        ...(deleted.user_id !== principal.userId
          ? {
              details: {
                owner: deleted.user_id ? "other user" : "organisation",
              },
            }
          : {}),
      });

      return {
        success: true,
        message: "API key deleted successfully",
      };
    } catch (error) {
      logger.error("Error deleting API key:", error);
      return {
        success: false,
        message: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  validate: async (
    input: z.infer<typeof ValidateApiKeyRequestSchema>,
  ): Promise<z.infer<typeof ValidateApiKeyResponseSchema>> => {
    try {
      const result = await apiKeysRepository.validateApiKey(input.key);
      return {
        valid: result.valid,
        user_id: result.user_id ?? undefined,
        key_uuid: result.key_uuid,
        scope: result.scope,
        endpoint_uuids: result.endpoint_uuids,
      };
    } catch (error) {
      logger.error("Error validating API key:", error);
      return { valid: false };
    }
  },
};
