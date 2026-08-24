import { mcpRequestAuditLogsRepository } from "@/db/repositories/mcp-request-audit-logs.repo";

import { CallToolHandler, CallToolMiddleware } from "./functional-middleware";

export interface AuditToolIdentity {
  mcpServerUuid?: string;
  mcpServerName?: string;
}

export interface AuditCallToolMiddlewareOptions {
  resolveToolIdentity?: (
    toolName: string,
    namespaceUuid: string,
  ) => Promise<AuditToolIdentity>;
  createAuditLog?: typeof mcpRequestAuditLogsRepository.create;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function resolveSafely(
  options: AuditCallToolMiddlewareOptions,
  toolName: string,
  namespaceUuid: string,
): Promise<AuditToolIdentity> {
  if (!options.resolveToolIdentity) {
    return {};
  }

  try {
    return await options.resolveToolIdentity(toolName, namespaceUuid);
  } catch {
    return {};
  }
}

export function createAuditCallToolMiddleware(
  options: AuditCallToolMiddlewareOptions = {},
): CallToolMiddleware {
  const createAuditLog =
    options.createAuditLog?.bind(mcpRequestAuditLogsRepository) ??
    mcpRequestAuditLogsRepository.create.bind(mcpRequestAuditLogsRepository);

  return (handler: CallToolHandler): CallToolHandler => {
    return async (request, context) => {
      const startTime = performance.now();

      try {
        const response = await handler(request, context);
        const durationMs = Math.round(performance.now() - startTime);
        const toolIdentity = await resolveSafely(
          options,
          request.params.name,
          context.namespaceUuid,
        );

        void createAuditLog({
          endpointName: context.endpointName,
          namespaceUuid: context.namespaceUuid,
          sessionId: context.sessionId,
          authMethod: context.auth?.method || "none",
          apiKeyUuid: context.auth?.apiKeyUuid,
          apiKeyUserId: context.auth?.apiKeyUserId,
          oauthUserId: context.auth?.oauthUserId,
          mcpServerUuid: toolIdentity.mcpServerUuid,
          mcpServerName: toolIdentity.mcpServerName,
          toolName: request.params.name,
          status: response.isError ? "ERROR" : "SUCCESS",
          durationMs,
          errorMessage:
            response.isError && response.content?.[0]?.type === "text"
              ? response.content[0].text
              : undefined,
        });

        return response;
      } catch (error) {
        const durationMs = Math.round(performance.now() - startTime);
        const toolIdentity = await resolveSafely(
          options,
          request.params.name,
          context.namespaceUuid,
        );

        void createAuditLog({
          endpointName: context.endpointName,
          namespaceUuid: context.namespaceUuid,
          sessionId: context.sessionId,
          authMethod: context.auth?.method || "none",
          apiKeyUuid: context.auth?.apiKeyUuid,
          apiKeyUserId: context.auth?.apiKeyUserId,
          oauthUserId: context.auth?.oauthUserId,
          mcpServerUuid: toolIdentity.mcpServerUuid,
          mcpServerName: toolIdentity.mcpServerName,
          toolName: request.params.name,
          status: "ERROR",
          durationMs,
          errorMessage: getErrorMessage(error),
        });

        throw error;
      }
    };
  };
}
