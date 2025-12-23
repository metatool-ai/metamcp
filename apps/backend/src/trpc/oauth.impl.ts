import {
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { oauthSessionsRepository } from "../db/repositories";
import { OAuthSessionsSerializer } from "../db/serializers";
import logger from "@/utils/logger";

export const oauthImplementations = {
  get: async (
    input: z.infer<typeof GetOAuthSessionRequestSchema>,
  ): Promise<z.infer<typeof GetOAuthSessionResponseSchema>> => {
    try {
      const session = await oauthSessionsRepository.findByMcpServerUuid(
        input.mcp_server_uuid,
      );

      if (!session) {
        return {
          success: false as const,
          message: "OAuth session not found",
        };
      }

      return {
        success: true as const,
        data: OAuthSessionsSerializer.serializeOAuthSession(session),
        message: "OAuth session retrieved successfully",
      };
    } catch (error) {
      logger.error("Error fetching OAuth session:", error);
      return {
        success: false as const,
        message: "Failed to fetch OAuth session",
      };
    }
  },

  upsert: async (
    input: z.infer<typeof UpsertOAuthSessionRequestSchema>,
  ): Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>> => {
    try {
      const session = await oauthSessionsRepository.upsert({
        mcp_server_uuid: input.mcp_server_uuid,
        ...(input.client_information && {
          client_information: input.client_information,
        }),
        ...(input.tokens && { tokens: input.tokens }),
        ...(input.code_verifier && { code_verifier: input.code_verifier }),
      });

      if (!session) {
        return {
          success: false as const,
          error: "Failed to upsert OAuth session",
        };
      }

      return {
        success: true as const,
        data: OAuthSessionsSerializer.serializeOAuthSession(session),
        message: "OAuth session upserted successfully",
      };
    } catch (error) {
      logger.error("Error upserting OAuth session:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },
};
