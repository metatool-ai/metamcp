import {
  ClearLogsResponseSchema,
  GetLogsRequestSchema,
  GetLogsResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import { assertAdminUserId } from "../lib/access-control";
import { isMultiTenantMode } from "../lib/admin";
import { metamcpLogStore } from "../lib/metamcp/log-store";

export const logsImplementations = {
  getLogs: async (
    input: z.infer<typeof GetLogsRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof GetLogsResponseSchema>> => {
    // Log entries are global and only carry a server *name* (no owner or
    // server id), so they cannot be scoped per user. In multi-tenant mode
    // only administrators may read them.
    if (isMultiTenantMode()) {
      await assertAdminUserId(
        userId,
        "Only administrators can view server logs",
      );
    }
    try {
      const logs = metamcpLogStore.getLogs(input.limit);
      const totalCount = metamcpLogStore.getLogCount();

      return {
        success: true as const,
        data: logs,
        totalCount,
      };
    } catch (error) {
      logger.error("Error getting logs:", error);
      throw new Error("Failed to get logs");
    }
  },

  clearLogs: async (
    userId: string,
  ): Promise<z.infer<typeof ClearLogsResponseSchema>> => {
    await assertAdminUserId(userId, "Only administrators can clear logs");
    try {
      metamcpLogStore.clearLogs();

      return {
        success: true as const,
        message: "All logs have been cleared successfully",
      };
    } catch (error) {
      logger.error("Error clearing logs:", error);
      throw new Error("Failed to clear logs");
    }
  },
};
