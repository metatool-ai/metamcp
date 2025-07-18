import { initTRPC, TRPCError } from "@trpc/server";
import { OpenApiMeta } from "trpc-to-openapi";

// Create context interface that can be extended by backend
export interface BaseContext {
  // Auth data that can be added by backend implementations
  // Using generic types so backends can use their own User/Session types
  user?: any;
  session?: any;
}

// Initialize tRPC for frontend (without OpenAPI meta)
const t = initTRPC.context<BaseContext>().create();

// Initialize tRPC for headless API (with OpenAPI meta)
export const createHeadlessRouter = () => {
  // Import OpenAPI meta dynamically to avoid affecting frontend
  const headlessTRPC = initTRPC
    .context<BaseContext>()
    .meta<OpenApiMeta>()
    .create();
  return headlessTRPC;
};

// Export router and procedure helpers for frontend
export const router = t.router;
export const publicProcedure = t.procedure;
export const createTRPCRouter = t.router;
export const baseProcedure = t.procedure;

// Create a protected procedure that requires authentication
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource",
    });
  }

  return next({
    ctx: {
      ...ctx,
      // Override types to indicate user and session are guaranteed to exist
      user: ctx.user,
      session: ctx.session,
    },
  });
});
