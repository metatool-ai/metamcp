import {
  type AccessPrincipal,
  CreateToolRequestSchema,
  CreateToolResponseSchema,
  GetToolsByMcpServerUuidRequestSchema,
  GetToolsByMcpServerUuidResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import { mcpServersRepository, toolsRepository } from "../db/repositories";
import { ToolsSerializer } from "../db/serializers";
import { accessService } from "../lib/access/access.service";
import { hasLevel } from "../lib/access/resource-guards";
import { publicErrorMessage } from "../lib/errors";
import { toolsSyncCache } from "../lib/metamcp/tools-sync-cache";

/**
 * Tools are defined per MCP server and shared by every namespace using it:
 * reading them needs "use" on the server, writing them needs "edit" (tool
 * descriptions end up in LLM prompts, so they must not be forgeable).
 */
async function serverAccessLevel(
  mcpServerUuid: string,
  principal: AccessPrincipal,
) {
  const server = await mcpServersRepository.findByUuid(mcpServerUuid);
  if (!server) return null;
  return accessService.resolveAccessOne(principal, "mcp_server", server);
}

export const toolsImplementations = {
  getByMcpServerUuid: async (
    input: z.infer<typeof GetToolsByMcpServerUuidRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof GetToolsByMcpServerUuidResponseSchema>> => {
    try {
      if (!(await serverAccessLevel(input.mcpServerUuid, principal))) {
        return {
          success: false as const,
          data: [],
          message: "MCP server not found",
        };
      }
      const tools = await toolsRepository.findByMcpServerUuid(
        input.mcpServerUuid,
      );

      return {
        success: true as const,
        data: ToolsSerializer.serializeToolList(tools),
        message: "Tools retrieved successfully",
      };
    } catch (error) {
      logger.error("Error fetching tools by MCP server UUID:", error);
      return {
        success: false as const,
        data: [],
        message: "Failed to fetch tools",
      };
    }
  },

  create: async (
    input: z.infer<typeof CreateToolRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof CreateToolResponseSchema>> => {
    try {
      if (
        !hasLevel(
          await serverAccessLevel(input.mcpServerUuid, principal),
          "edit",
        )
      ) {
        return {
          success: false as const,
          count: 0,
          error: "Access denied: you need edit access to this MCP server",
        };
      }
      if (!input.tools || input.tools.length === 0) {
        return {
          success: true as const,
          count: 0,
          message: "No tools to save",
        };
      }

      const results = await toolsRepository.bulkUpsert({
        tools: input.tools,
        mcpServerUuid: input.mcpServerUuid,
      });

      return {
        success: true as const,
        count: results.length,
        message: `Successfully saved ${results.length} tools`,
      };
    } catch (error) {
      logger.error("Error saving tools to database:", error);
      return {
        success: false as const,
        count: 0,
        error: publicErrorMessage(error, "Internal server error"),
      };
    }
  },

  /**
   * Smart sync with hash-check and cleanup
   * Only syncs if tools have actually changed (performance optimized)
   */
  sync: async (
    input: z.infer<typeof CreateToolRequestSchema>,
    principal: AccessPrincipal,
  ): Promise<z.infer<typeof CreateToolResponseSchema>> => {
    try {
      if (
        !hasLevel(
          await serverAccessLevel(input.mcpServerUuid, principal),
          "edit",
        )
      ) {
        return {
          success: false as const,
          count: 0,
          error: "Access denied: you need edit access to this MCP server",
        };
      }
      if (!input.tools || input.tools.length === 0) {
        return {
          success: true as const,
          count: 0,
          message: "No tools to sync",
        };
      }

      // Check if tools changed using hash
      const hasChanged = toolsSyncCache.hasChanged(
        input.mcpServerUuid,
        input.tools,
      );

      if (hasChanged) {
        // Perform sync with cleanup
        const { upserted, deleted } = await toolsRepository.syncTools({
          tools: input.tools,
          mcpServerUuid: input.mcpServerUuid,
        });

        // Only remember the state once it is stored: a failed write must be
        // retried by the next sync.
        toolsSyncCache.update(input.mcpServerUuid, input.tools);

        const message =
          deleted.length > 0
            ? `Successfully synced ${upserted.length} tools (removed ${deleted.length} obsolete)`
            : `Successfully synced ${upserted.length} tools`;

        return {
          success: true as const,
          count: upserted.length,
          message,
        };
      } else {
        return {
          success: true as const,
          count: input.tools.length,
          message: "Tools unchanged, skipped sync",
        };
      }
    } catch (error) {
      console.error("Error syncing tools to database:", error);
      return {
        success: false as const,
        count: 0,
        error: publicErrorMessage(error, "Internal server error"),
      };
    }
  },
};
