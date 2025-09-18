import {
  ClearLogsResponseSchema,
  GetLogsRequestSchema,
  GetLogsResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

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
};
