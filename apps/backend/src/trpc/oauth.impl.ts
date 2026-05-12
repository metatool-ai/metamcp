import {
  ClearOAuthSessionRequestSchema,
  ClearOAuthSessionResponseSchema,
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import {
  mcpServersRepository,
  oauthSessionsRepository,
} from "../db/repositories";
import { OAuthSessionsSerializer } from "../db/serializers";

const hasOwn = <T extends object, K extends PropertyKey>(
  input: T,
  key: K,
): input is T & Record<K, unknown> =>
  Object.prototype.hasOwnProperty.call(input, key);

async function findAccessibleServer(mcpServerUuid: string, userId: string) {
  const server = await mcpServersRepository.findByUuid(mcpServerUuid);

  if (!server) {
    return {
      success: false as const,
      message: "MCP server not found",
    };
  }

  if (server.user_id && server.user_id !== userId) {
    return {
      success: false as const,
      message:
        "Access denied: You can only access OAuth sessions for servers you own",
    };
  }

  return {
    success: true as const,
    server,
  };
}

async function findMutableServer(mcpServerUuid: string, userId: string) {
  const result = await findAccessibleServer(mcpServerUuid, userId);

  if (!result.success) {
    return result;
  }

  if (result.server.user_id === null) {
    return {
      success: false as const,
      message:
        "OAuth credentials for public MCP servers cannot be modified from a user session",
    };
  }

  return result;
}

export const oauthImplementations = {
  get: async (
    input: z.infer<typeof GetOAuthSessionRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof GetOAuthSessionResponseSchema>> => {
    try {
      const serverAccess = await findAccessibleServer(
        input.mcp_server_uuid,
        userId,
      );
      if (!serverAccess.success) {
        return {
          success: false as const,
          message: serverAccess.message,
        };
      }

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
    userId: string,
  ): Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>> => {
    try {
      const serverAccess = await findMutableServer(
        input.mcp_server_uuid,
        userId,
      );
      if (!serverAccess.success) {
        return {
          success: false as const,
          error: serverAccess.message,
        };
      }

      const session = await oauthSessionsRepository.upsert({
        mcp_server_uuid: input.mcp_server_uuid,
        ...(hasOwn(input, "client_information") && {
          client_information: input.client_information,
        }),
        ...(hasOwn(input, "tokens") && { tokens: input.tokens }),
        ...(hasOwn(input, "code_verifier") && {
          code_verifier: input.code_verifier,
        }),
        ...(hasOwn(input, "tokens_obtained_at") && {
          tokens_obtained_at: input.tokens_obtained_at,
        }),
        ...(hasOwn(input, "token_expires_at") && {
          token_expires_at: input.token_expires_at,
        }),
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

  clear: async (
    input: z.infer<typeof ClearOAuthSessionRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof ClearOAuthSessionResponseSchema>> => {
    try {
      const serverAccess = await findMutableServer(
        input.mcp_server_uuid,
        userId,
      );
      if (!serverAccess.success) {
        return {
          success: false as const,
          error: serverAccess.message,
        };
      }

      await oauthSessionsRepository.clearByMcpServerUuid(
        input.mcp_server_uuid,
        input.scope,
      );

      return {
        success: true as const,
        message: "OAuth credentials cleared successfully",
      };
    } catch (error) {
      logger.error("Error clearing OAuth credentials:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },
};
