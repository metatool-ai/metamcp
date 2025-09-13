/**
 * Shared utility for parsing MetaMCP tool names (Frontend version)
 * 
 * Tool names follow the format: {ServerPrefix}__{toolName}
 * Where ServerPrefix can be nested: Parent__Child__GrandChild
 * The last __ is always the separator between server prefix and actual tool name
 */

export interface ParsedToolName {
  serverName: string;
  originalToolName: string;
}

/**
 * Parse a MetaMCP tool name into server prefix and tool name components
 * 
 * @param toolName - Full tool name (e.g., "Server__tool" or "Parent__Child__tool")
 * @returns Parsed components or null if invalid format
 * 
 * @example
 * parseToolName("Hacker-News__get_stories") 
 * // → { serverName: "Hacker-News", originalToolName: "get_stories" }
 * 
 * @example
 * parseToolName("Parent__Child__my_tool")
 * // → { serverName: "Parent__Child", originalToolName: "my_tool" }
 */
export function parseToolName(toolName: string): ParsedToolName | null {
  const lastDoubleUnderscoreIndex = toolName.lastIndexOf("__");
  if (lastDoubleUnderscoreIndex === -1) {
    return null;
  }

  // The last __ is always the separator between the full server prefix and the actual tool name
  // Everything before the last __ is the server prefix (which may contain nested servers)
  // Everything after the last __ is the actual tool name
  const serverName = toolName.substring(0, lastDoubleUnderscoreIndex);
  const originalToolName = toolName.substring(lastDoubleUnderscoreIndex + 2);

  return {
    serverName,
    originalToolName,
  };
}

/**
 * Create a tool name from server prefix and tool name
 * 
 * @param serverName - Server prefix (can be nested like "Parent__Child")
 * @param toolName - Tool name
 * @returns Full tool name
 * 
 * @example
 * createToolName("Hacker-News", "get_stories")
 * // → "Hacker-News__get_stories"
 */
export function createToolName(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`;
}
