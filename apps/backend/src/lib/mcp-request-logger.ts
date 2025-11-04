import { mcpRequestLogsRepository } from "../db/repositories";
import { mcpSessionStorage } from "./mcp-session-storage";

/**
 * Log an MCP request and response
 */
export async function logMcpRequest(params: {
  sessionId: string;
  requestType: string;
  requestParams?: Record<string, any>;
  responseResult?: Record<string, any>;
  responseStatus: "success" | "error";
  errorMessage?: string;
  toolName?: string;
  startTime: number;
}): Promise<void> {
  const {
    sessionId,
    requestType,
    requestParams,
    responseResult,
    responseStatus,
    errorMessage,
    toolName,
    startTime,
  } = params;

  try {
    // Get session info
    const sessionInfo = mcpSessionStorage.getSession(sessionId);

    // Calculate duration
    const durationMs = (Date.now() - startTime).toString();

    // Log to database
    await mcpRequestLogsRepository.create({
      client_id: sessionInfo?.clientId || null,
      user_id: sessionInfo?.userId || null,
      session_id: sessionId,
      endpoint_name: sessionInfo?.endpointName || null,
      namespace_uuid: sessionInfo?.namespaceUuid || null,
      request_type: requestType,
      request_params: requestParams || null,
      response_result: responseResult || null,
      response_status: responseStatus,
      error_message: errorMessage || null,
      tool_name: toolName || null,
      duration_ms: durationMs,
    });
  } catch (error) {
    // Don't fail the request if logging fails
    console.error("Failed to log MCP request:", error);
  }
}

/**
 * Create a wrapper that logs MCP requests
 */
export function createMcpRequestLogger<TRequest, TResult>(
  requestType: string,
  handler: (
    request: TRequest,
    sessionId: string,
  ) => Promise<TResult> | TResult,
): (request: TRequest, sessionId: string) => Promise<TResult> {
  return async (request: TRequest, sessionId: string): Promise<TResult> => {
    const startTime = Date.now();
    let responseResult: any = null;
    let responseStatus: "success" | "error" = "success";
    let errorMessage: string | undefined;
    let toolName: string | undefined;

    try {
      // Extract tool name for call_tool requests
      if (requestType === "call_tool" && typeof request === "object" && request !== null && "params" in request) {
        const params = (request as any).params;
        toolName = params?.name;
      }

      // Execute the handler
      const result = await handler(request, sessionId);
      responseResult = result;

      return result;
    } catch (error) {
      responseStatus = "error";
      errorMessage =
        error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      // Log the request (don't await to avoid blocking)
      logMcpRequest({
        sessionId,
        requestType,
        requestParams: request as any,
        responseResult,
        responseStatus,
        errorMessage,
        toolName,
        startTime,
      }).catch((err) => {
        console.error("Failed to log MCP request in wrapper:", err);
      });
    }
  };
}
