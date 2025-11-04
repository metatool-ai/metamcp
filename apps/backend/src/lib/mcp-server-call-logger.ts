import { db } from "../db/index";
import { mcpServerCallLogsTable } from "../db/schema";
import { mcpSessionStorage } from "./mcp-session-storage";

/**
 * Log a call from MetaMCP to a real MCP server
 */
export async function logMcpServerCall(params: {
  sessionId: string;
  mcpServerUuid: string;
  mcpServerName: string;
  toolName: string;
  toolArguments: Record<string, any>;
  result?: Record<string, any>;
  status: "success" | "error";
  errorMessage?: string;
  startTime: number;
}): Promise<void> {
  const {
    sessionId,
    mcpServerUuid,
    mcpServerName,
    toolName,
    toolArguments,
    result,
    status,
    errorMessage,
    startTime,
  } = params;

  try {
    // Get session info to associate with OAuth client
    const sessionInfo = mcpSessionStorage.getSession(sessionId);

    // Calculate duration
    const durationMs = (Date.now() - startTime).toString();

    // Debug logging
    console.log("[MCP Server Call Logger] Logging call to MCP server:", {
      sessionId,
      mcpServerName,
      toolName,
      status,
      hasSessionInfo: !!sessionInfo,
      clientId: sessionInfo?.clientId || null,
    });

    // Log to database
    await db.insert(mcpServerCallLogsTable).values({
      client_id: sessionInfo?.clientId || null,
      user_id: sessionInfo?.userId || null,
      session_id: sessionId,
      endpoint_name: sessionInfo?.endpointName || null,
      namespace_uuid: sessionInfo?.namespaceUuid || null,
      mcp_server_uuid: mcpServerUuid,
      mcp_server_name: mcpServerName,
      tool_name: toolName,
      tool_arguments: toolArguments,
      result: result || null,
      status,
      error_message: errorMessage || null,
      duration_ms: durationMs,
    });

    console.log("[MCP Server Call Logger] Successfully logged to database");
  } catch (error) {
    // Don't fail the request if logging fails
    console.error("Failed to log MCP server call:", error);
  }
}
