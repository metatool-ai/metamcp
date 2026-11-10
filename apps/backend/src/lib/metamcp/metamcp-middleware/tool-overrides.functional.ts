import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";

import logger from "@/utils/logger";

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

/**
 * Configuration for the tool overrides middleware
 */
export interface ToolOverridesConfig {
  cacheEnabled?: boolean;
  cacheTTL?: number; // milliseconds
}

/**
 * Tool override information
 */
interface ToolOverride {
  overrideName?: string | null;
  overrideTitle?: string | null;
  overrideDescription?: string | null;
  overrideAnnotations?: Record<string, unknown> | null;
}

function mergeAnnotations(
  original: Tool["annotations"],
  namespaceOverrides?: Record<string, unknown> | null,
): Tool["annotations"] | undefined {
  if (!namespaceOverrides || Object.keys(namespaceOverrides).length === 0) {
    return original;
  }

  const baseAnnotations = (original ? { ...original } : {}) as Record<
    string,
    unknown
  >;

  for (const [key, value] of Object.entries(namespaceOverrides)) {
    baseAnnotations[key] = value;
  }

  return baseAnnotations as Tool["annotations"];
}

/**
 * Tool overrides cache for performance
 */
class ToolOverridesCache {
  private reverseNameCache = new Map<string, string>();

  private getReverseKey(namespaceUuid: string, overrideName: string): string {
    return namespaceUuid + ":" + overrideName;
  }

  getOriginalName(namespaceUuid: string, overrideName: string): string | null {
    return this.reverseNameCache.get(this.getReverseKey(namespaceUuid, overrideName)) || null;
  }

  setOriginalName(namespaceUuid: string, overrideName: string, originalName: string): void {
    this.reverseNameCache.set(this.getReverseKey(namespaceUuid, overrideName), originalName);
  }

  clear(namespaceUuid?: string): void {
    if (namespaceUuid) {
      for (const key of this.reverseNameCache.keys()) {
        if (key.startsWith(namespaceUuid + ":")) this.reverseNameCache.delete(key);
      }
    } else {
      this.reverseNameCache.clear();
    }
  }
}

// Global cache instance
const toolOverridesCache = new ToolOverridesCache();

// parseToolName is now imported from shared utility

/**
 * Apply overrides to tools
 */
async function applyToolOverrides(
  tools: Tool[],
  namespaceUuid: string,
  useCache: boolean = true,
): Promise<Tool[]> {
  if (!tools || tools.length === 0) return tools;
  let mappings: Array<{
    toolName: string;
    serverName: string;
    overrideName: string | null;
    overrideTitle: string | null;
    overrideDescription: string | null;
    overrideAnnotations: Record<string, unknown> | null;
  }>;
  try {
    mappings = await db
      .select({
        toolName: toolsTable.name,
        serverName: mcpServersTable.name,
        overrideName: namespaceToolMappingsTable.override_name,
        overrideTitle: namespaceToolMappingsTable.override_title,
        overrideDescription: namespaceToolMappingsTable.override_description,
        overrideAnnotations: namespaceToolMappingsTable.override_annotations,
      })
      .from(namespaceToolMappingsTable)
      .innerJoin(toolsTable, eq(toolsTable.uuid, namespaceToolMappingsTable.tool_uuid))
      .innerJoin(mcpServersTable, eq(mcpServersTable.uuid, namespaceToolMappingsTable.mcp_server_uuid))
      .where(eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid));
  } catch (error) {
    logger.error("Error fetching tool overrides for namespace " + namespaceUuid + ":", error);
    return tools;
  }
  const overridesByName = new Map<string, (typeof mappings)[number]>(
    mappings.map(
      (mapping) => [mapping.serverName + "__" + mapping.toolName, mapping] as const,
    ),
  );
  return tools.map((tool) => {
    const parsed = parseToolName(tool.name);
    if (!parsed) return tool;
    const mapping = overridesByName.get(tool.name);
    if (!mapping) return tool;
    const override: ToolOverride = {
      overrideName: mapping.overrideName,
      overrideTitle: mapping.overrideTitle,
      overrideDescription: mapping.overrideDescription,
      overrideAnnotations: mapping.overrideAnnotations,
    };
    const overriddenName =
      override.overrideName && override.overrideName.trim() !== ""
        ? parsed.serverName + "__" + override.overrideName
        : tool.name;
    const overriddenDescription =
      override.overrideDescription !== null ? override.overrideDescription : tool.description;
    let overriddenTitle: string | undefined = tool.title;
    if (typeof override.overrideTitle !== "undefined") {
      overriddenTitle = override.overrideTitle === null ? undefined : override.overrideTitle;
    }
    let overriddenAnnotations =
      tool.annotations && Object.keys(tool.annotations).length > 0
        ? { ...tool.annotations }
        : undefined;
    if (overriddenAnnotations && "title" in overriddenAnnotations) {
      const { title: _removed, ...rest } = overriddenAnnotations;
      overriddenAnnotations = Object.keys(rest).length > 0 ? rest : undefined;
    }
    overriddenAnnotations = mergeAnnotations(overriddenAnnotations, override.overrideAnnotations);
    if (override.overrideName && useCache) {
      toolOverridesCache.setOriginalName(namespaceUuid, override.overrideName, tool.name);
    }
    return {
      ...tool,
      name: overriddenName,
      title: overriddenTitle,
      description: overriddenDescription,
      annotations: overriddenAnnotations,
    };
  });
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
