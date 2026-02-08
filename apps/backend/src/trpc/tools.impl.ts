import {
  CreateToolRequestSchema,
  CreateToolResponseSchema,
  GetToolsByMcpServerUuidRequestSchema,
  GetToolsByMcpServerUuidResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { toolsRepository } from "../db/repositories";
import { ToolsSerializer } from "../db/serializers";
import logger from "@/utils/logger";
import { toolsSyncCache } from "../lib/metamcp/tools-sync-cache";

export const toolsImplementations = {
  getByMcpServerUuid: async (
    input: z.infer<typeof GetToolsByMcpServerUuidRequestSchema>,
  ): Promise<z.infer<typeof GetToolsByMcpServerUuidResponseSchema>> => {
    try {
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
  ): Promise<z.infer<typeof CreateToolResponseSchema>> => {
    try {
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
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },


  /**
   * Smart sync with hash-check and cleanup
   * Only syncs if tools have actually changed (performance optimized)
   */
  sync: async (
    input: z.infer<typeof CreateToolRequestSchema>,
  ): Promise<z.infer<typeof CreateToolResponseSchema>> => {
    try {
      if (!input.tools || input.tools.length === 0) {
        return {
          success: true as const,
          count: 0,
          message: "No tools to sync",
        };
      }

      // Check if tools changed using hash
      const toolNames = input.tools.map((tool) => tool.name);
      const hasChanged = toolsSyncCache.hasChanged(input.mcpServerUuid, toolNames);

      if (hasChanged) {
        // Update cache
        toolsSyncCache.update(input.mcpServerUuid, toolNames);
        
        // Perform sync with cleanup
        const { upserted, deleted } = await toolsRepository.syncTools({
          tools: input.tools,
          mcpServerUuid: input.mcpServerUuid,
        });

        const message = deleted.length > 0
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
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },
};
