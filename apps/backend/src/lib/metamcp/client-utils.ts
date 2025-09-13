import { CallToolResult, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { 
  ConnectedClient, 
  RestApiConnectedClient, 
  AnyConnectedClient 
} from "./client";

/**
 * Type guard to check if a client is a REST API client
 */
export function isRestApiClient(client: AnyConnectedClient): client is RestApiConnectedClient {
  return 'restApiServer' in client;
}

/**
 * Type guard to check if a client is a standard MCP client
 */
export function isStandardMcpClient(client: AnyConnectedClient): client is ConnectedClient {
  return 'client' in client;
}

/**
 * List tools from any type of MCP client
 */
export async function listToolsFromClient(client: AnyConnectedClient): Promise<ListToolsResult> {
  if (isRestApiClient(client)) {
    return await client.restApiServer.listTools();
  } else if (isStandardMcpClient(client)) {
    return await client.client.listTools();
  } else {
    throw new Error("Unknown client type");
  }
}

/**
 * Call a tool on any type of MCP client
 */
export async function callToolOnClient(
  client: AnyConnectedClient, 
  name: string, 
  args: any = {}
): Promise<CallToolResult> {
  if (isRestApiClient(client)) {
    return await client.restApiServer.callTool(name, args);
  } else if (isStandardMcpClient(client)) {
    return await client.client.callTool({ name, arguments: args });
  } else {
    throw new Error("Unknown client type");
  }
}

/**
 * Get server information from any type of MCP client
 */
export function getServerInfo(client: AnyConnectedClient): { type: string; name?: string } {
  if (isRestApiClient(client)) {
    const info = client.restApiServer.getServerInfo();
    return {
      type: info.type,
      name: info.name,
    };
  } else if (isStandardMcpClient(client)) {
    return {
      type: "MCP",
      name: "Standard MCP Server",
    };
  } else {
    throw new Error("Unknown client type");
  }
}

/**
 * Cleanup any type of MCP client
 */
export async function cleanupClient(client: AnyConnectedClient): Promise<void> {
  await client.cleanup();
}

/**
 * Check if a client supports a specific capability
 */
export function clientSupportsCapability(
  client: AnyConnectedClient, 
  capability: 'tools' | 'resources' | 'prompts'
): boolean {
  if (isRestApiClient(client)) {
    // REST API clients only support tools
    return capability === 'tools';
  } else if (isStandardMcpClient(client)) {
    // Standard MCP clients support all capabilities
    return true;
  } else {
    return false;
  }
}

/**
 * Get tool count from any type of MCP client
 */
export async function getToolCount(client: AnyConnectedClient): Promise<number> {
  try {
    const toolsResult = await listToolsFromClient(client);
    return toolsResult.tools?.length || 0;
  } catch (error) {
    console.error("Failed to get tool count:", error);
    return 0;
  }
}

/**
 * Test connection for any type of MCP client
 */
export async function testClientConnection(client: AnyConnectedClient): Promise<{ success: boolean; message: string }> {
  try {
    if (isRestApiClient(client)) {
      return await client.restApiServer.testConnection();
    } else if (isStandardMcpClient(client)) {
      // For standard MCP clients, try to list tools as a connection test
      await client.client.listTools();
      return { success: true, message: "Connection successful" };
    } else {
      return { success: false, message: "Unknown client type" };
    }
  } catch (error) {
    return { 
      success: false, 
      message: error instanceof Error ? error.message : "Connection test failed" 
    };
  }
}
