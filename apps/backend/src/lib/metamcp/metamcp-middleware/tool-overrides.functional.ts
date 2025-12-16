import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";

import { db } from "../../../db/index";
import {
  mcpServersTable,
  namespaceToolMappingsTable,
  toolsTable,
} from "../../../db/schema";
import { parseToolName } from "../tool-name-parser";
import {
  CallToolMiddleware,
  ListToolsMiddleware,
} from "./functional-middleware";
import logger from "@/utils/logger";

/**
 * Configuration for the tool overrides middleware
 */
export interface ToolOverridesConfig {
  cacheEnabled?: boolean;
  cacheTTL?: number; // milliseconds
  persistentCacheOnListTools?: boolean; // if true, cache never expires when set via list tools
}

/**
 * Tool override information
 */
interface ToolOverride {
  overrideName?: string | null;
  overrideDescription?: string | null;
}

/**
 * Tool overrides cache for performance
 */
class ToolOverridesCache {
  private overrideCache = new Map<string, ToolOverride>();
  private reverseNameCache = new Map<string, string>(); // overrideName -> originalName
  private expiry = new Map<string, number>();
  private persistentKeys = new Set<string>(); // keys that never expire
  private ttl: number;

  constructor(ttl: number = 1000) {
    this.ttl = ttl;
  }

  private getCacheKey(
    namespaceUuid: string,
    serverName: string,
    toolName: string,
  ): string {
    return `${namespaceUuid}:${serverName}:${toolName}`;
  }

  private getReverseKey(namespaceUuid: string, overrideName: string): string {
    return `${namespaceUuid}:${overrideName}`;
  }

  get(
    namespaceUuid: string,
    serverName: string,
    toolName: string,
  ): ToolOverride | null {
    const key = this.getCacheKey(namespaceUuid, serverName, toolName);

    // Check if this is a persistent key that never expires
    if (this.persistentKeys.has(key)) {
      return this.overrideCache.get(key) || null;
    }

    const expiry = this.expiry.get(key);

    if (!expiry || Date.now() > expiry) {
      this.overrideCache.delete(key);
      this.expiry.delete(key);
      return null;
    }

    return this.overrideCache.get(key) || null;
  }

  set(
    namespaceUuid: string,
    serverName: string,
    toolName: string,
    override: ToolOverride,
    isPersistent: boolean = false,
  ): void {
    const key = this.getCacheKey(namespaceUuid, serverName, toolName);
    this.overrideCache.set(key, override);

    if (isPersistent) {
      // Mark as persistent - never expires
      this.persistentKeys.add(key);
    } else {
      // Set normal expiry
      this.expiry.set(key, Date.now() + this.ttl);
    }

    // Also cache reverse lookup if there's an override name
    if (override.overrideName) {
      const reverseKey = this.getReverseKey(
        namespaceUuid,
        override.overrideName,
      );
      this.reverseNameCache.set(reverseKey, `${serverName}__${toolName}`);
    }
  }

  getOriginalName(namespaceUuid: string, overrideName: string): string | null {
    const reverseKey = this.getReverseKey(namespaceUuid, overrideName);
    return this.reverseNameCache.get(reverseKey) || null;
  }

  setOriginalName(
    namespaceUuid: string,
    overrideName: string,
    originalName: string,
  ): void {
    const reverseKey = this.getReverseKey(namespaceUuid, overrideName);
    this.reverseNameCache.set(reverseKey, originalName);
  }

  clear(namespaceUuid?: string): void {
    if (namespaceUuid) {
      for (const key of this.overrideCache.keys()) {
        if (key.startsWith(`${namespaceUuid}:`)) {
          this.overrideCache.delete(key);
          this.expiry.delete(key);
          this.persistentKeys.delete(key);
        }
      }
      for (const key of this.reverseNameCache.keys()) {
        if (key.startsWith(`${namespaceUuid}:`)) {
          this.reverseNameCache.delete(key);
        }
      }
    } else {
      this.overrideCache.clear();
      this.reverseNameCache.clear();
      this.expiry.clear();
      this.persistentKeys.clear();
    }
  }
}

// Global cache instance
const toolOverridesCache = new ToolOverridesCache();

/**
 * Get tool overrides from database with caching
 */
async function getToolOverrides(
  namespaceUuid: string,
  serverName: string,
  toolName: string,
  useCache: boolean = true,
  isPersistent: boolean = false,
): Promise<ToolOverride | null> {
  // Check cache first
  if (useCache) {
    const cached = toolOverridesCache.get(namespaceUuid, serverName, toolName);
    if (cached !== null) {
      return cached;
    }
  }

  try {
    // Get server UUID by name
    const [server] = await db
      .select({ uuid: mcpServersTable.uuid })
      .from(mcpServersTable)
      .where(eq(mcpServersTable.name, serverName));

    if (!server) {
      return null;
    }

    // Query database for tool overrides
    const [toolMapping] = await db
      .select({
        overrideName: namespaceToolMappingsTable.override_name,
        overrideDescription: namespaceToolMappingsTable.override_description,
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
          eq(namespaceToolMappingsTable.mcp_server_uuid, server.uuid),
        ),
      );

    const override: ToolOverride = {
      overrideName: toolMapping?.overrideName || null,
      overrideDescription: toolMapping?.overrideDescription || null,
    };

    // Cache the result if found and caching is enabled
    if (toolMapping && useCache) {
      toolOverridesCache.set(
        namespaceUuid,
        serverName,
        toolName,
        override,
        isPersistent,
      );
    }

    return override;
  } catch (error) {
    logger.error(
      `Error fetching tool overrides for ${toolName} in namespace ${namespaceUuid}:`,
      error,
    );
    return null;
  }
}

// parseToolName is now imported from shared utility

/**
 * Apply overrides to tools
 */
async function applyToolOverrides(
  tools: Tool[],
  namespaceUuid: string,
  useCache: boolean = true,
  isPersistent: boolean = false,
): Promise<Tool[]> {
  if (!tools || tools.length === 0) {
    return tools;
  }

  const overriddenTools: Tool[] = [];

  await Promise.allSettled(
    tools.map(async (tool) => {
      try {
        const parsed = parseToolName(tool.name);
        if (!parsed) {
          // If tool name doesn't follow expected format, include as-is
          overriddenTools.push(tool);
          return;
        }

        const override = await getToolOverrides(
          namespaceUuid,
          parsed.serverName,
          parsed.originalToolName,
          useCache,
          isPersistent,
        );

        if (!override) {
          // No overrides found, include as-is
          overriddenTools.push(tool);
          return;
        }

        // Apply overrides - preserve server prefix format
        // For name: only apply if overrideName is not null and not empty
        const overriddenName =
          override.overrideName && override.overrideName.trim() !== ""
            ? `${parsed.serverName}__${override.overrideName}`
            : tool.name;

        // For description: apply override if it's not null, even if empty string
        // This allows users to explicitly set empty descriptions
        const overriddenDescription =
          override.overrideDescription !== null
            ? override.overrideDescription
            : tool.description;

        const overriddenTool: Tool = {
          ...tool,
          name: overriddenName,
          description: overriddenDescription,
        };

        // Update reverse mapping cache for the new full override name
        if (override.overrideName && useCache) {
          toolOverridesCache.setOriginalName(
            namespaceUuid,
            override.overrideName,
            tool.name,
          );
        }

        overriddenTools.push(overriddenTool);
      } catch (error) {
        logger.error(`Error applying overrides for tool ${tool.name}:`, error);
        // On error, include the tool as-is (fail-safe behavior)
        overriddenTools.push(tool);
      }
    }),
  );

  return overriddenTools;
}

/**
 * Map override name back to original name for tool calls
 */
export async function mapOverrideNameToOriginal(
  toolName: string,
  namespaceUuid: string,
  useCache: boolean = true,
): Promise<string> {
  // Parse the tool name to extract server and tool parts
  const parsed = parseToolName(toolName);
  if (!parsed) {
    // If tool name doesn't follow expected format, return as-is
    return toolName;
  }

  // First check if this might be an override name using just the tool part
  if (useCache) {
    const originalName = toolOverridesCache.getOriginalName(
      namespaceUuid,
      parsed.originalToolName,
    );
    if (originalName) {
      return originalName;
    }
  }

  // If not found in cache or cache disabled, query database
  try {
    const [toolMapping] = await db
      .select({
        originalName: toolsTable.name,
        serverName: mcpServersTable.name,
      })
      .from(namespaceToolMappingsTable)
      .innerJoin(
        toolsTable,
        eq(toolsTable.uuid, namespaceToolMappingsTable.tool_uuid),
      )
      .innerJoin(
        mcpServersTable,
        eq(mcpServersTable.uuid, namespaceToolMappingsTable.mcp_server_uuid),
      )
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceToolMappingsTable.override_name, parsed.originalToolName),
          eq(mcpServersTable.name, parsed.serverName),
        ),
      );

    if (toolMapping) {
      const originalFullName = `${toolMapping.serverName}__${toolMapping.originalName}`;

      // Cache the reverse mapping using the tool part only
      if (useCache) {
        toolOverridesCache.setOriginalName(
          namespaceUuid,
          parsed.originalToolName,
          originalFullName,
        );
      }

      return originalFullName;
    }
  } catch (error) {
    logger.error(
      `Error mapping override name ${toolName} to original in namespace ${namespaceUuid}:`,
      error,
    );
  }

  // If no mapping found, return the original name
  return toolName;
}

/**
 * Creates a List Tools middleware that applies tool name/description overrides
 */
export function createToolOverridesListToolsMiddleware(
  config: ToolOverridesConfig = {},
): ListToolsMiddleware {
  const useCache = config.cacheEnabled ?? true;
  const isPersistent = config.persistentCacheOnListTools ?? false;

  return (handler) => {
    return async (request, context) => {
      // Call the original handler to get the tools
      const response = await handler(request, context);

      // Apply overrides to the tools
      if (response.tools) {
        const overriddenTools = await applyToolOverrides(
          response.tools,
          context.namespaceUuid,
          useCache,
          isPersistent,
        );

        return {
          ...response,
          tools: overriddenTools,
        };
      }

      return response;
    };
  };
}

/**
 * Creates a Call Tool middleware that maps override names back to original names
 */
export function createToolOverridesCallToolMiddleware(
  config: ToolOverridesConfig = {},
): CallToolMiddleware {
  const useCache = config.cacheEnabled ?? true;

  return (handler) => {
    return async (request, context) => {
      // Map override name back to original name if needed
      const originalToolName = await mapOverrideNameToOriginal(
        request.params.name,
        context.namespaceUuid,
        useCache,
      );

      // Create a new request with the original tool name
      const modifiedRequest = {
        ...request,
        params: {
          ...request.params,
          name: originalToolName,
        },
      };

      // Call the original handler with the modified request
      return handler(modifiedRequest, context);
    };
  };
}

/**
 * Utility function to clear override cache
 */
export function clearOverrideCache(namespaceUuid?: string): void {
  toolOverridesCache.clear(namespaceUuid);
}
