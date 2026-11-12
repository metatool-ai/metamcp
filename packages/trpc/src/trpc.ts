import { initTRPC, TRPCError } from "@trpc/server";

// Create context interface that can be extended by backend
export interface BaseContext {
  // Auth data that can be added by backend implementations
  // Using generic types so backends can use their own User/Session types
  user?: any;
  session?: any;
}

// Initialize tRPC with base context
const t = initTRPC.context<BaseContext>().create();

// Export router and procedure helpers
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

/**
 * Procedure restricted to administrators. Administrators are listed in
 * METAMCP_ADMIN_EMAILS (comma-separated). When that variable is unset every
 * signed-in user is an administrator (single-tenant mode).
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  // This package has no Node typings; read the env through globalThis.
  const raw = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.METAMCP_ADMIN_EMAILS;
  if (raw && raw.trim()) {
    const admins = raw
      .split(",")
      .map((e: string) => e.trim().toLowerCase())
      .filter(Boolean);
    const email = String(ctx.user?.email ?? "")
      .trim()
      .toLowerCase();
    if (!email || !admins.includes(email)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Administrator access required",
      });
    }
  }
  return next({ ctx });
});
