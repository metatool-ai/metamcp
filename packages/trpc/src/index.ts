// Export tRPC setup
export {
  protectedProcedure,
  publicProcedure,
  router,
  baseProcedure,
  createTRPCRouter,
  createHeadlessRouter,
} from "./trpc";
export type { BaseContext } from "./trpc";

// Export router creators
export { createAppRouter, createFrontendRouter } from "./router";
export { createHeadlessAppRouter } from "./routers/headless";
export { createMcpServersRouter } from "./routers/frontend";

// Export all zod types for convenience
export * from "@repo/zod-types";
