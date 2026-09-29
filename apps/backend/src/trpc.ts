import type { BaseContext } from "@repo/trpc";
import type { AccessPrincipal } from "@repo/zod-types";
import type { Request, Response } from "express";

import { auth, type Session, type User } from "./auth";
import { accessService } from "./lib/access/access.service";
import logger from "./utils/logger";

// Extend the base context with Express request/response and auth data
export interface Context extends BaseContext {
  req: Request;
  res: Response;
  user?: User;
  session?: Session;
  principal?: AccessPrincipal;
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
  let principal: AccessPrincipal | undefined;

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
          // Disabled or deleted users resolve to no principal and are
          // therefore treated as anonymous by every procedure.
          const resolved = await accessService.getPrincipal(
            sessionData.user.id,
          );
          if (resolved) {
            user = sessionData.user;
            session = sessionData.session;
            principal = resolved;
          }
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
    principal,
  };
};
