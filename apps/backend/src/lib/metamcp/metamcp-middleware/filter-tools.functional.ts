import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";

import { db } from "../../../db/index";
import {
  mcpServersTable,
  namespaceToolMappingsTable,
  toolsTable,
} from "../../../db/schema";
import {
  CallToolMiddleware,
  ListToolsMiddleware,
} from "./functional-middleware";

/**
 * Configuration for the filter middleware
 */
export interface FilterToolsConfig {
  cacheEnabled?: boolean;
  cacheTTL?: number; // milliseconds
  customErrorMessage?: (toolName: string, reason: string) => string;
}

/**
 * Tool status cache for performance
 */
class ToolStatusCache {
  private cache = new Map<string, "ACTIVE" | "INACTIVE">();
  private expiry = new Map<string, number>();
  private ttl: number;

  constructor(ttl: number = 1000) {
    this.ttl = ttl;
  }

  private getCacheKey(
    namespaceUuid: string,
    toolName: string,
    serverUuid: string,
  ): string {
    return `${namespaceUuid}:${serverUuid}:${toolName}`;
  }

  get(
    namespaceUuid: string,
    toolName: string,
    serverUuid: string,
  ): "ACTIVE" | "INACTIVE" | null {
    const key = this.getCacheKey(namespaceUuid, toolName, serverUuid);
    const expiry = this.expiry.get(key);

    if (!expiry || Date.now() > expiry) {
      this.cache.delete(key);
      this.expiry.delete(key);
      return null;
    }

    return this.cache.get(key) || null;
  }

  set(
    namespaceUuid: string,
    toolName: string,
    serverUuid: string,
    status: "ACTIVE" | "INACTIVE",
  ): void {
    const key = this.getCacheKey(namespaceUuid, toolName, serverUuid);
    this.cache.set(key, status);
    this.expiry.set(key, Date.now() + this.ttl);
  }

  clear(namespaceUuid?: string): void {
    if (namespaceUuid) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${namespaceUuid}:`)) {
          this.cache.delete(key);
          this.expiry.delete(key);
        }
      }
    } else {
      this.cache.clear();
      this.expiry.clear();
    }
  }
}

// Global cache instance
const toolStatusCache = new ToolStatusCache();

/**
 * Get tool status from database with caching
 */
async function getToolStatus(
  namespaceUuid: string,
  toolName: string,
  serverUuid: string,
  useCache: boolean = true,
): Promise<"ACTIVE" | "INACTIVE" | null> {
  // Check cache first
  if (useCache) {
    const cached = toolStatusCache.get(namespaceUuid, toolName, serverUuid);
    if (cached !== null) {
      return cached;
    }
  }

  try {
    // Query database for tool status
    const [toolMapping] = await db
      .select({
        status: namespaceToolMappingsTable.status,
      })
      .from(namespaceToolMappingsTable)
      .innerJoin(
        toolsTable,
        eq(toolsTable.uuid, namespaceToolMappingsTable.tool_uuid),
      )
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          eq(toolsTable.name, toolName),
          eq(namespaceToolMappingsTable.mcp_server_uuid, serverUuid),
        ),
      );

    const status = toolMapping?.status || null;

    // Cache the result if found and caching is enabled
    if (status && useCache) {
      toolStatusCache.set(namespaceUuid, toolName, serverUuid, status);
    }

    return status;
  } catch (error) {
    console.error(
      `Error fetching tool status for ${toolName} in namespace ${namespaceUuid}:`,
      error,
    );
    return null;
  }
}

/**
 * Extract server info from tool name
 */
function parseToolName(
  toolName: string,
): { serverName: string; originalToolName: string } | null {
  const firstDoubleUnderscoreIndex = toolName.indexOf("__");
  if (firstDoubleUnderscoreIndex === -1) {
    return null;
  }

  return {
    serverName: toolName.substring(0, firstDoubleUnderscoreIndex),
    originalToolName: toolName.substring(firstDoubleUnderscoreIndex + 2),
  };
}

/**
 * Get server UUID by name
 */
async function getServerUuidByName(serverName: string): Promise<string | null> {
  try {
    const [server] = await db
      .select({ uuid: mcpServersTable.uuid })
      .from(mcpServersTable)
      .where(eq(mcpServersTable.name, serverName));

    return server?.uuid || null;
  } catch (error) {
    console.error(`Error fetching server UUID for ${serverName}:`, error);
    return null;
  }
}

/**
 * Filter tools based on their status in the namespace
 */
async function filterActiveTools(
  tools: Tool[],
  namespaceUuid: string,
  useCache: boolean = true,
): Promise<Tool[]> {
  if (!tools || tools.length === 0) {
    return tools;
  }

  const activeTools: Tool[] = [];

  await Promise.allSettled(
    tools.map(async (tool) => {
      try {
        const parsed = parseToolName(tool.name);
        if (!parsed) {
          // If tool name doesn't follow expected format, include it
          activeTools.push(tool);
          return;
        }

        const serverUuid = await getServerUuidByName(parsed.serverName);
        if (!serverUuid) {
          // If server not found, include the tool (fallback behavior)
          activeTools.push(tool);
          return;
        }

        const status = await getToolStatus(
          namespaceUuid,
          parsed.originalToolName,
          serverUuid,
          useCache,
        );

        // If no mapping exists or tool is active, include it
        if (status === null || status === "ACTIVE") {
          activeTools.push(tool);
        }
        // If status is "INACTIVE", tool is filtered out
      } catch (error) {
        console.error(`Error checking tool status for ${tool.name}:`, error);
        // On error, include the tool (fail-safe behavior)
        activeTools.push(tool);
      }
    }),
  );

  return activeTools;
}

/**
 * Check if a tool is allowed to be called
 */
async function isToolAllowed(
  toolName: string,
  namespaceUuid: string,
  serverUuid: string,
  useCache: boolean = true,
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const parsed = parseToolName(toolName);
    if (!parsed) {
      // If tool name doesn't follow expected format, allow it
      return { allowed: true };
    }

    const status = await getToolStatus(
      namespaceUuid,
      parsed.originalToolName,
      serverUuid,
      useCache,
    );

    // If no mapping exists or tool is active, allow it
    if (status === null || status === "ACTIVE") {
      return { allowed: true };
    }

    // Tool is inactive
    return {
      allowed: false,
      reason: "Tool has been marked as inactive in this namespace",
    };
  } catch (error) {
    console.error(
      `Error checking if tool ${toolName} is allowed in namespace ${namespaceUuid}:`,
      error,
    );
    // On error, allow the tool (fail-safe behavior)
    return { allowed: true };
  }
}

/**
 * Creates a List Tools middleware that filters out inactive tools
 */
export function createFilterListToolsMiddleware(
  config: FilterToolsConfig = {},
): ListToolsMiddleware {
  const useCache = config.cacheEnabled ?? true;

  return (handler) => {
    return async (request, context) => {
      // Call the original handler to get the tools
      const response = await handler(request, context);

      // Filter the tools based on namespace tool mappings
      if (response.tools) {
        const filteredTools = await filterActiveTools(
          response.tools,
          context.namespaceUuid,
          useCache,
        );

        return {
          ...response,
          tools: filteredTools,
        };
      }

      return response;
    };
  };
}

/**
 * Creates a Call Tool middleware that blocks calls to inactive tools
 */
export function createFilterCallToolMiddleware(
  config: FilterToolsConfig = {},
): CallToolMiddleware {
  const useCache = config.cacheEnabled ?? true;
  const customErrorMessage =
    config.customErrorMessage ??
    ((toolName: string, reason: string) =>
      `Tool "${toolName}" is currently inactive and disallowed in this namespace: ${reason}`);

  return (handler) => {
    return async (request, context) => {
      // Extract tool name and server info from the request
      const toolName = request.params.name;

      // We need to get serverUuid somehow - this would need to be passed through context
      // For now, let's extract it from the tool name format
      const parsed = parseToolName(toolName);
      if (parsed) {
        const serverUuid = await getServerUuidByName(parsed.serverName);
        if (serverUuid) {
          const { allowed, reason } = await isToolAllowed(
            toolName,
            context.namespaceUuid,
            serverUuid,
            useCache,
          );

          if (!allowed) {
            // Return error response instead of calling the handler
            return {
              content: [
                {
                  type: "text",
                  text: customErrorMessage(
                    toolName,
                    reason || "Unknown reason",
                  ),
                },
              ],
              isError: true,
            };
          }
        }
      }

      // Tool is allowed, call the original handler
      return handler(request, context);
    };
  };
}

/**
 * Utility function to clear cache
 */
export function clearFilterCache(namespaceUuid?: string): void {
  toolStatusCache.clear(namespaceUuid);
}
