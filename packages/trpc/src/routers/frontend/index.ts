import { createApiKeysRouter } from "./api-keys";
import { createConfigRouter } from "./config";
import { createEndpointsRouter } from "./endpoints";
import { createLogsRouter } from "./logs";
import { createMcpServersRouter } from "./mcp-servers";
import { createNamespacesRouter } from "./namespaces";
import { createOAuthRouter } from "./oauth";
import { createToolsRouter } from "./tools";
import { createUsersRouter } from "./users";

export { createMcpServersRouter };
export { createNamespacesRouter };
export { createEndpointsRouter };
export { createOAuthRouter };
export { createToolsRouter };
export { createApiKeysRouter };
export { createConfigRouter };
export { createUsersRouter };

export const createFrontendRouter = (implementations: {
  mcpServers: Parameters<typeof createMcpServersRouter>[0];
  namespaces: Parameters<typeof createNamespacesRouter>[0];
  endpoints: Parameters<typeof createEndpointsRouter>[0];
  oauth: Parameters<typeof createOAuthRouter>[0];
  tools: Parameters<typeof createToolsRouter>[0];
  apiKeys: Parameters<typeof createApiKeysRouter>[0];
  config: Parameters<typeof createConfigRouter>[0];
  logs: Parameters<typeof createLogsRouter>[0];
  users: Parameters<typeof createUsersRouter>[0];
}) => {
  return {
    mcpServers: createMcpServersRouter(implementations.mcpServers),
    namespaces: createNamespacesRouter(implementations.namespaces),
    endpoints: createEndpointsRouter(implementations.endpoints),
    oauth: createOAuthRouter(implementations.oauth),
    tools: createToolsRouter(implementations.tools),
    apiKeys: createApiKeysRouter(implementations.apiKeys),
    config: createConfigRouter(implementations.config),
    logs: createLogsRouter(implementations.logs),
    users: createUsersRouter(implementations.users),
  };
};
