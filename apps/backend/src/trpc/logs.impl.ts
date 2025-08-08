import {
  ClearLogsResponseSchema,
  GetDockerLogsRequestSchema,
  GetDockerLogsResponseSchema,
  GetLogsRequestSchema,
  GetLogsResponseSchema,
  ListDockerServersResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { dockerManager } from "../lib/metamcp/docker-manager";
import { metamcpLogStore } from "../lib/metamcp/log-store";

export const logsImplementations = {
  getLogs: async (
    input: z.infer<typeof GetLogsRequestSchema>,
  ): Promise<z.infer<typeof GetLogsResponseSchema>> => {
    try {
      const logs = metamcpLogStore.getLogs(input.limit);
      const totalCount = metamcpLogStore.getLogCount();

      return {
        success: true as const,
        data: logs,
        totalCount,
      };
    } catch (error) {
      console.error("Error getting logs:", error);
      throw new Error("Failed to get logs");
    }
  },

  clearLogs: async (): Promise<z.infer<typeof ClearLogsResponseSchema>> => {
    try {
      metamcpLogStore.clearLogs();

      return {
        success: true as const,
        message: "All logs have been cleared successfully",
      };
    } catch (error) {
      console.error("Error clearing logs:", error);
      throw new Error("Failed to clear logs");
    }
  },

  listDockerServers: async (): Promise<
    z.infer<typeof ListDockerServersResponseSchema>
  > => {
    try {
      const running = await dockerManager.getRunningServers();
      return {
        success: true as const,
        servers: running.map((s) => ({
          serverUuid: s.serverUuid,
          containerId: s.containerId,
          containerName: s.containerName,
          serverName: s.serverName,
        })),
      };
    } catch (error) {
      console.error("Error listing docker servers:", error);
      return { success: true as const, servers: [] };
    }
  },

  getDockerLogs: async (
    input: z.infer<typeof GetDockerLogsRequestSchema>,
  ): Promise<z.infer<typeof GetDockerLogsResponseSchema>> => {
    const tail = input.tail ?? 500;
    try {
      const lines = await dockerManager.getServerLogsTail(
        input.serverUuid,
        tail,
      );
      return {
        success: true as const,
        serverUuid: input.serverUuid,
        lines,
      };
    } catch (error) {
      console.error("Error getting docker logs:", error);
      return {
        success: true as const,
        serverUuid: input.serverUuid,
        lines: [],
      };
    }
  },
};
