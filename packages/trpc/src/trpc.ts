import type { AccessPrincipal } from "@repo/zod-types";
import { initTRPC, TRPCError } from "@trpc/server";

// Create context interface that can be extended by backend
export interface BaseContext {
  // Auth data that can be added by backend implementations
  // Using generic types so backends can use their own User/Session types
  user?: any;
  session?: any;
  // Resolved RBAC principal (effective role, capabilities, groups). Absent for
  // anonymous requests and for disabled users.
  principal?: AccessPrincipal;
}

/**
 * Whether an unexpected error comes from the database. Drizzle's query errors
 * embed the SQL text and its parameters (possibly credentials being written):
 * such messages must never reach the browser. Only duck-typing here: this
 * package does not depend on the database driver.
 */
function isDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth++
  ) {
    const candidate = current as {
      name?: unknown;
      message?: unknown;
      severity?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    if (
      candidate.name === "DrizzleQueryError" ||
      (typeof candidate.message === "string" &&
        candidate.message.startsWith("Failed query:")) ||
      (typeof candidate.severity === "string" &&
        typeof candidate.code === "string")
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

// This package is also type-checked without Node.js typings.
const nodeEnv = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env?.NODE_ENV;

// Initialize tRPC with base context. Stack traces are only included in
// development, and database errors are replaced by a generic message.
const t = initTRPC.context<BaseContext>().create({
  isDev: nodeEnv === "development",
  errorFormatter({ shape, error }) {
    if (error.code === "INTERNAL_SERVER_ERROR" && isDatabaseError(error)) {
      return { ...shape, message: "Internal server error" };
    }
    return shape;
  },
});

// Export router and procedure helpers
export const router = t.router;
export const publicProcedure = t.procedure;
export const createTRPCRouter = t.router;
export const baseProcedure = t.procedure;

// Create a protected procedure that requires authentication
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.session || !ctx.principal) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource",
    });
  }

  return next({
    ctx: {
      ...ctx,
      // Override types to indicate user, session and principal are guaranteed to exist
      user: ctx.user,
      session: ctx.session,
      principal: ctx.principal,
    },
  });
});

// Procedures reserved to administrators (effective role "admin").
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.principal.isAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Administrator access is required for this action",
    });
  }
  return next();
});
