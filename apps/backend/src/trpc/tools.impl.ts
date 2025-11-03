import {
  CreateToolRequestSchema,
  CreateToolResponseSchema,
  GetToolsByMcpServerUuidRequestSchema,
  GetToolsByMcpServerUuidResponseSchema,
  UpdateToolAccessTypeRequestSchema,
  UpdateToolAccessTypeResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { toolsRepository } from "../db/repositories";
import { ToolsSerializer } from "../db/serializers";

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
      console.error("Error fetching tools by MCP server UUID:", error);
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
      console.error("Error saving tools to database:", error);
      return {
        success: false as const,
        count: 0,
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  updateAccessType: async (
    input: z.infer<typeof UpdateToolAccessTypeRequestSchema>,
  ): Promise<z.infer<typeof UpdateToolAccessTypeResponseSchema>> => {
    try {
      const updatedTool = await toolsRepository.updateAccessType(
        input.toolUuid,
        input.accessType,
      );

      if (!updatedTool) {
        return {
          success: false,
          message: "Tool not found",
        };
      }

      return {
        success: true,
        message: "Access type updated successfully",
      };
    } catch (error) {
      console.error("Error updating tool access type:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to update access type",
      };
    }
  },
};
