import { createHeadlessRouter } from "../../trpc";
import { createHeadlessMcpServersRouter } from "./mcp-servers";

export { createHeadlessMcpServersRouter };

export const createHeadlessRouters = (implementations: {
  mcpServers: Parameters<typeof createHeadlessMcpServersRouter>[0];
}) => {
  return {
    mcpServers: createHeadlessMcpServersRouter(implementations.mcpServers),
  };
};

// Create standalone headless app router with OpenAPI support
export const createHeadlessAppRouter = (implementations: {
  mcpServers: Parameters<typeof createHeadlessMcpServersRouter>[0];
}) => {
  const headlessRouters = createHeadlessRouters(implementations);
  const headlessTRPC = createHeadlessRouter();

  return headlessTRPC.router({
    mcpServers: headlessRouters.mcpServers,
  });
};
