import type { BaseContext } from "@repo/trpc";
import { initTRPC, TRPCError } from "@trpc/server";
import type { Request, Response } from "express";

import { auth, type Session, type User } from "./auth";
import logger from "./utils/logger";

// Extend the base context with Express request/response and auth data
export interface Context extends BaseContext {
  req: Request;
  res: Response;
  user?: User;
  session?: Session;
}

// Create context from Express request/response with auth
export const createContext = async ({
  req,
  res,
}: {
  req: Request;
  res: Response;
}): Promise<Context> => {
  let user: User | undefined;
  let session: Session | undefined;

  try {
    // Check if we have cookies in the request
    if (req.headers.cookie) {
      // Create a proper Request object for better-auth
      const sessionUrl = new URL(
        "/api/auth/get-session",
        `http://${req.headers.host}`,
      );

      const headers = new Headers();
      headers.set("cookie", req.headers.cookie);

      const sessionRequest = new Request(sessionUrl.toString(), {
        method: "GET",
        headers,
      });

      const sessionResponse = await auth.handler(sessionRequest);

      if (sessionResponse.ok) {
        const sessionData = (await sessionResponse.json()) as {
          user?: User;
          session?: Session;
        };

        if (sessionData?.user && sessionData?.session) {
          user = sessionData.user;
          session = sessionData.session;
        }
      }
    }
  } catch (error) {
    // Log error but don't throw - we want to allow unauthenticated requests
    logger.error("Error getting session in tRPC context:", error);
  }

  return {
    req,
    res,
    user,
    session,
  };
};

// Initialize tRPC with extended context
const t = initTRPC.context<Context>().create();

// Export router and procedure helpers
export const router = t.router;
export const publicProcedure = t.procedure;

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
    } as Context & { user: User; session: Session },
  });
});
