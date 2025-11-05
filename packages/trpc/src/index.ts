// Export tRPC setup
export {
  protectedProcedure,
  publicProcedure,
  router,
  baseProcedure,
  createTRPCRouter,
} from "./trpc";
export type { BaseContext } from "./trpc";

// Export router creators
export { createAppRouter, createFrontendRouter } from "./router";
export type { AppRouter } from "./router";
export { createMcpServersRouter } from "./routers/frontend";

// Export all zod types for convenience
export * from "@repo/zod-types";
