import {
  CreateApiKeyRequestSchema,
  CreateApiKeyResponseSchema,
  DeleteApiKeyRequestSchema,
  DeleteApiKeyResponseSchema,
  ListApiKeysResponseSchema,
  UpdateApiKeyRequestSchema,
  UpdateApiKeyResponseSchema,
  ValidateApiKeyRequestSchema,
  ValidateApiKeyResponseSchema,
} from "@repo/zod-types";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import logger from "@/utils/logger";

import { ApiKeysRepository } from "../db/repositories";
import { ApiKeysSerializer } from "../db/serializers";
import {
  createSecretsVisibility,
  isAdminUserId,
  resolveRequestedOwner,
} from "../lib/access-control";

const apiKeysRepository = new ApiKeysRepository();

function maskApiKey(key: string): string {
  if (key.length <= 10) return "********";
  return `${key.slice(0, 6)}********${key.slice(-4)}`;
}

export const apiKeysImplementations = {
  create: async (
    input: z.infer<typeof CreateApiKeyRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof CreateApiKeyResponseSchema>> => {
    try {
      // Only the caller's own id or null (public, admin only) may be
      // requested; default to the current user (private).
      const apiKeyUserId = await resolveRequestedOwner(
        input.user_id,
        userId,
        userId,
      );

      const result = await apiKeysRepository.create({
        name: input.name,
        user_id: apiKeyUserId,
        is_active: true,
      });

      return ApiKeysSerializer.serializeCreateApiKeyResponse(result);
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      logger.error("Error creating API key:", error);
      throw new Error(
        error instanceof Error ? error.message : "Internal server error",
      );
    }
  },

  list: async (
    userId: string,
  ): Promise<z.infer<typeof ListApiKeysResponseSchema>> => {
    try {
      const apiKeys = await apiKeysRepository.findAccessibleToUser(userId);
      // Public keys are listed to everyone, but their secret value is only
      // returned to administrators.
      const canSeeKey = await createSecretsVisibility(userId);

      return {
        apiKeys: ApiKeysSerializer.serializeApiKeyList(apiKeys).map((key) =>
          canSeeKey(key.user_id) ? key : { ...key, key: maskApiKey(key.key) },
        ),
      };
    } catch (error) {
      logger.error("Error fetching API keys:", error);
      throw new Error("Failed to fetch API keys");
    }
  },

  update: async (
    input: z.infer<typeof UpdateApiKeyRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof UpdateApiKeyResponseSchema>> => {
    try {
      const result = await apiKeysRepository.update(
        input.uuid,
        userId,
        {
          name: input.name,
          is_active: input.is_active,
        },
        { allowPublic: await isAdminUserId(userId) },
      );

      return ApiKeysSerializer.serializeApiKey(result);
    } catch (error) {
      logger.error("Error updating API key:", error);
      throw new Error(
        error instanceof Error ? error.message : "Internal server error",
      );
    }
  },

  delete: async (
    input: z.infer<typeof DeleteApiKeyRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof DeleteApiKeyResponseSchema>> => {
    try {
      await apiKeysRepository.delete(input.uuid, userId, {
        allowPublic: await isAdminUserId(userId),
      });

      return {
        success: true,
        message: "API key deleted successfully",
      };
    } catch (error) {
      logger.error("Error deleting API key:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Internal server error",
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
      };
    } catch (error) {
      logger.error("Error validating API key:", error);
      return { valid: false };
    }
  },
};
