import {
  type AccessPrincipal,
  ListMcpRequestAuditLogsRequestSchema,
  ListMcpRequestAuditLogsResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { mcpRequestAuditLogsRepository } from "@/db/repositories/mcp-request-audit-logs.repo";
import logger from "@/utils/logger";

export const mcpRequestAuditLogsImplementations = {
  list: async (
    input: z.infer<typeof ListMcpRequestAuditLogsRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof ListMcpRequestAuditLogsResponseSchema>> => {
    try {
      const logs = await mcpRequestAuditLogsRepository.list({
        userId: principal.userId,
        includeAll: principal.isAdmin,
        limit: input.limit,
        offset: input.offset,
        endpointName: input.endpointName,
        apiKeyUuid: input.apiKeyUuid,
        namespaceUuid: input.namespaceUuid,
        status: input.status,
      });

      return logs;
    } catch (error) {
      logger.error("Error fetching MCP request audit logs:", error);
      throw new Error("Failed to fetch MCP request audit logs");
    }
  },
};
