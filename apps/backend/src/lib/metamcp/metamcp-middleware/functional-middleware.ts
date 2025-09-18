import {
  CallToolRequest,
  CallToolResult,
  ListToolsRequest,
  ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

// Base context for all handlers
export interface MetaMCPHandlerContext {
  namespaceUuid: string;
  sessionId: string;
}

// Handler function types
export type ListToolsHandler = (
  request: ListToolsRequest,
  context: MetaMCPHandlerContext,
) => Promise<ListToolsResult>;

export type CallToolHandler = (
  request: CallToolRequest,
  context: MetaMCPHandlerContext,
) => Promise<CallToolResult>;

// Middleware function types that can transform request/response
export type ListToolsMiddleware = (
  handler: ListToolsHandler,
) => ListToolsHandler;

export type CallToolMiddleware = (handler: CallToolHandler) => CallToolHandler;

// Request transformer type (for future use)
export type RequestTransformer<T> = (
  request: T,
  context: MetaMCPHandlerContext,
) => Promise<T> | T;

// Response transformer type
export type ResponseTransformer<T> = (
  response: T,
  context: MetaMCPHandlerContext,
) => Promise<T> | T;

/**
 * Creates a functional middleware that can transform requests and responses
 */
export function createFunctionalMiddleware<TRequest, TResponse>(options: {
  transformRequest?: RequestTransformer<TRequest>;
  transformResponse?: ResponseTransformer<TResponse>;
}) {
  return (
    handler: (
      request: TRequest,
      context: MetaMCPHandlerContext,
    ) => Promise<TResponse>,
  ) => {
    return async (
      request: TRequest,
      context: MetaMCPHandlerContext,
    ): Promise<TResponse> => {
      // Transform request if transformer provided
      let transformedRequest = request;
      if (options.transformRequest) {
        transformedRequest = await Promise.resolve(
          options.transformRequest(request, context),
        );
      }

      // Call the original handler
      let response = await handler(transformedRequest, context);

      // Transform response if transformer provided
      if (options.transformResponse) {
        response = await Promise.resolve(
          options.transformResponse(response, context),
        );
      }

      return response;
    };
  };
}

/**
 * Compose multiple middleware functions together
 */
// TODO better typing for middleware design
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function compose<T extends (...args: any[]) => any>(
  ...middlewares: Array<(handler: T) => T>
): (handler: T) => T {
  return (handler: T) => {
    return middlewares.reduceRight(
      (wrapped, middleware) => middleware(wrapped),
      handler,
    );
  };
}
