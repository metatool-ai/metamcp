import {
  DeleteOAuthClientRequestSchema,
  DeleteOAuthClientResponseSchema,
  GetAllOAuthClientsResponseSchema,
  GetMcpRequestLogsRequestSchema,
  GetMcpRequestLogsResponseSchema,
  GetMcpServerCallLogsRequestSchema,
  GetMcpServerCallLogsResponseSchema,
  GetOAuthRequestLogsRequestSchema,
  GetOAuthRequestLogsResponseSchema,
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  UpdateOAuthClientAdminAccessRequestSchema,
  UpdateOAuthClientAdminAccessResponseSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import {
  mcpRequestLogsRepository,
  oauthRepository,
  oauthRequestLogsRepository,
  oauthSessionsRepository,
} from "../db/repositories";
import { mcpServerCallLogsRepository } from "../db/repositories/mcp-server-call-logs.repo";
import { OAuthSessionsSerializer } from "../db/serializers";

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
      console.error("Error fetching OAuth session:", error);
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
      console.error("Error upserting OAuth session:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  getAllClients: async (): Promise<
    z.infer<typeof GetAllOAuthClientsResponseSchema>
  > => {
    try {
      const clients = await oauthRepository.getAllClients();

      return {
        success: true,
        data: clients.map((client) => ({
          ...client,
          created_at: client.created_at.toISOString(),
          updated_at: client.updated_at?.toISOString(),
        })),
      };
    } catch (error) {
      console.error("Error fetching OAuth clients:", error);
      return {
        success: false,
        data: [],
        message: "Failed to fetch OAuth clients",
      };
    }
  },

  updateClientAdminAccess: async (
    input: z.infer<typeof UpdateOAuthClientAdminAccessRequestSchema>,
  ): Promise<z.infer<typeof UpdateOAuthClientAdminAccessResponseSchema>> => {
    try {
      await oauthRepository.updateClientAdminAccess(
        input.clientId,
        input.canAccessAdmin,
      );

      return {
        success: true,
        message: "OAuth client admin access updated successfully",
      };
    } catch (error) {
      console.error("Error updating OAuth client admin access:", error);
      return {
        success: false,
        message: "Failed to update OAuth client admin access",
      };
    }
  },

  deleteClient: async (
    input: z.infer<typeof DeleteOAuthClientRequestSchema>,
  ): Promise<z.infer<typeof DeleteOAuthClientResponseSchema>> => {
    try {
      await oauthRepository.deleteClient(input.clientId);

      return {
        success: true,
        message: "OAuth client deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting OAuth client:", error);
      return {
        success: false,
        message: "Failed to delete OAuth client",
      };
    }
  },

  getRequestLogs: async (
    input: z.infer<typeof GetOAuthRequestLogsRequestSchema>,
  ): Promise<z.infer<typeof GetOAuthRequestLogsResponseSchema>> => {
    try {
      const { logs, total } = await oauthRequestLogsRepository.findMany({
        clientId: input.clientId,
        limit: input.limit,
        offset: input.offset,
      });

      return {
        success: true,
        data: logs.map((log) => ({
          ...log,
          created_at: log.created_at.toISOString(),
        })),
        total,
      };
    } catch (error) {
      console.error("Error fetching OAuth request logs:", error);
      return {
        success: false,
        data: [],
        total: 0,
        message: "Failed to fetch OAuth request logs",
      };
    }
  },

  getMcpRequestLogs: async (
    input: z.infer<typeof GetMcpRequestLogsRequestSchema>,
  ): Promise<z.infer<typeof GetMcpRequestLogsResponseSchema>> => {
    try {
      const { logs, total } = await mcpRequestLogsRepository.findMany({
        clientId: input.clientId,
        sessionId: input.sessionId,
        requestType: input.requestType,
        limit: input.limit,
        offset: input.offset,
      });

      return {
        success: true,
        data: logs.map((log) => ({
          ...log,
          created_at: log.created_at.toISOString(),
        })),
        total,
      };
    } catch (error) {
      console.error("Error fetching MCP request logs:", error);
      return {
        success: false,
        data: [],
        total: 0,
        message: "Failed to fetch MCP request logs",
      };
    }
  },

  getMcpServerCallLogs: async (
    input: z.infer<typeof GetMcpServerCallLogsRequestSchema>,
  ): Promise<z.infer<typeof GetMcpServerCallLogsResponseSchema>> => {
    try {
      const { logs, total } = await mcpServerCallLogsRepository.findMany({
        clientId: input.clientId,
        sessionId: input.sessionId,
        mcpServerUuid: input.mcpServerUuid,
        toolName: input.toolName,
        limit: input.limit,
        offset: input.offset,
      });

      return {
        success: true,
        data: logs.map((log) => ({
          ...log,
          created_at: log.created_at.toISOString(),
        })),
        total,
      };
    } catch (error) {
      console.error("Error fetching MCP server call logs:", error);
      return {
        success: false,
        data: [],
        total: 0,
        message: "Failed to fetch MCP server call logs",
      };
    }
  },
};
