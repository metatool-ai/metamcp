import {
  CreateToolRequestSchema,
  CreateToolResponseSchema,
  GetToolsByMcpServerUuidRequestSchema,
  GetToolsByMcpServerUuidResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import { mcpServersRepository, toolsRepository } from "../db/repositories";
import { ToolsSerializer } from "../db/serializers";
import { canModifyResource, canReadResource } from "../lib/access-control";
import { toolsSyncCache } from "../lib/metamcp/tools-sync-cache";

type ServerAccess = "read" | "write";

// Returns an error message when the caller may not access the server, or
// null when access is allowed. Inaccessible servers are reported as "not
// found" so the existence of other users' servers is not disclosed.
async function checkServerAccess(
  mcpServerUuid: string,
  userId: string,
  access: ServerAccess,
): Promise<string | null> {
  const server = await mcpServersRepository.findByUuid(mcpServerUuid);
  if (!server || !canReadResource(server.user_id, userId)) {
    return "MCP server not found";
  }
  if (
    access === "write" &&
    !(await canModifyResource(server.user_id, userId))
  ) {
    return "Access denied: you can only modify tools of MCP servers you own (public servers require an administrator)";
  }
  return null;
}

/**
 * Smart sync with hash-check and cleanup. Only syncs if tools have actually
 * changed (performance optimized).
 *
 * INTERNAL: performs no authorization. Callers acting on behalf of a user
 * must go through `toolsImplementations.sync`, which checks ownership.
 */
export async function syncToolsForServer(
  input: z.infer<typeof CreateToolRequestSchema>,
): Promise<z.infer<typeof CreateToolResponseSchema>> {
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
    const hasChanged = toolsSyncCache.hasChanged(
      input.mcpServerUuid,
      toolNames,
    );

    if (hasChanged) {
      // Update cache
      toolsSyncCache.update(input.mcpServerUuid, toolNames);

      // Perform sync with cleanup
      const { upserted, deleted } = await toolsRepository.syncTools({
        tools: input.tools,
        mcpServerUuid: input.mcpServerUuid,
      });

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
      error: error instanceof Error ? error.message : "Internal server error",
    };
  }
}

export const toolsImplementations = {
  getByMcpServerUuid: async (
    input: z.infer<typeof GetToolsByMcpServerUuidRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof GetToolsByMcpServerUuidResponseSchema>> => {
    try {
      const accessError = await checkServerAccess(
        input.mcpServerUuid,
        userId,
        "read",
      );
      if (accessError) {
        return {
          success: false as const,
          data: [],
          message: accessError,
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
    userId: string,
  ): Promise<z.infer<typeof CreateToolResponseSchema>> => {
    try {
      const accessError = await checkServerAccess(
        input.mcpServerUuid,
        userId,
        "write",
      );
      if (accessError) {
        return { success: false as const, count: 0, error: accessError };
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
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  /**
   * Smart sync with hash-check and cleanup (removes obsolete tools). Requires
   * the caller to own the server (or be an administrator for public servers)
   * because the cleanup deletes tools and cascades namespace tool mappings.
   */
  sync: async (
    input: z.infer<typeof CreateToolRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof CreateToolResponseSchema>> => {
    try {
      const accessError = await checkServerAccess(
        input.mcpServerUuid,
        userId,
        "write",
      );
      if (accessError) {
        return { success: false as const, count: 0, error: accessError };
      }
    } catch (error) {
      logger.error("Error checking MCP server access for tools sync:", error);
      return {
        success: false as const,
        count: 0,
        error: "Internal server error",
      };
    }
    return syncToolsForServer(input);
  },
};
