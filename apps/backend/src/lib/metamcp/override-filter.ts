import { Tool } from "@modelcontextprotocol/sdk/types.js";

import logger from "@/utils/logger";

import { mapOverrideNameToOriginal } from "./metamcp-middleware/tool-overrides.functional";
import { sanitizeName } from "./utils";

/**
 * Filter out tools that are overrides of existing tools to prevent duplicates in the
 * database. Shared by the proxy's tools/list sync path and the background tools-sync
 * loop (extracted here to avoid a circular import between metamcp-proxy and
 * background-tools-sync).
 */
export async function filterOutOverrideTools(
  tools: Tool[],
  namespaceUuid: string,
  serverName: string,
): Promise<Tool[]> {
  if (!tools || tools.length === 0) {
    return tools;
  }

  const filteredTools: Tool[] = [];

  await Promise.allSettled(
    tools.map(async (tool) => {
      try {
        // Check if this tool name is actually an override name for an existing tool
        // by using the existing mapOverrideNameToOriginal function
        const fullToolName = `${sanitizeName(serverName)}__${tool.name}`;
        const originalName = await mapOverrideNameToOriginal(
          fullToolName,
          namespaceUuid,
          true, // use cache
        );

        // If the original name is different from the current name,
        // this tool is an override and should be filtered out
        if (originalName !== fullToolName) {
          // This is an override, skip it (don't save to database)
          return;
        }

        // This is not an override, include it
        filteredTools.push(tool);
      } catch (error) {
        logger.error(
          `Error checking if tool ${tool.name} is an override:`,
          error,
        );
        // On error, include the tool (fail-safe behavior)
        filteredTools.push(tool);
      }
    }),
  );

  return filteredTools;
}
