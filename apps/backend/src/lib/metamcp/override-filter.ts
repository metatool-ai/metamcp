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

  // Resolve the override verdict per tool in parallel, then filter in the
  // ORIGINAL array order. Using Promise.allSettled + a push from inside each
  // async callback makes the result order non-deterministic (array push order
  // follows completion, not source order) — a stable order keeps the DB tool
  // list deterministic across sync passes, which is what makes reaping and
  // diffing converge instead of churning.
  const verdicts = await Promise.allSettled(
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
        return originalName === fullToolName;
      } catch (error) {
        logger.error(
          `Error checking if tool ${tool.name} is an override:`,
          error,
        );
        // On error, include the tool (fail-safe behavior)
        return true;
      }
    }),
  );

  return tools.filter((tool, index) => {
    const verdict = verdicts[index];
    // allSettled never rejects; a non-fulfilled verdict defaults to include.
    return verdict?.status === "fulfilled" ? verdict.value : true;
  });
}
