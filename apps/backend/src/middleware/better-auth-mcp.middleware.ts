// TODO resolve any issue with better-auth
/* eslint-disable @typescript-eslint/no-explicit-any */
import express from "express";

import { auth } from "../auth";

/**
 * Better Auth middleware for MCP proxy routes
 * Uses original request cookies for session validation
 */
export const betterAuthMcpMiddleware = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  try {
    // Check if we have cookies in the request
    if (!req.headers.cookie) {
      console.log("Auth middleware - no cookies found in request");
      return res.status(401).json({
        error: "Authentication required",
        message: "No session cookies found",
      });
    }

    // Verify the session using better-auth with original cookies
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

    if (!sessionResponse.ok) {
      console.log("Auth middleware - session verification failed");
      return res.status(401).json({
        error: "Invalid session",
        message: "Session verification failed",
      });
    }

    const sessionData = (await sessionResponse.json()) as any;

    if (!sessionData || !sessionData.user) {
      console.log("Auth middleware - no valid user session found");
      return res.status(401).json({
        error: "Invalid session",
        message: "No valid user session found",
      });
    }

    // Add user info to request for downstream use
    (req as any).user = sessionData.user;
    (req as any).session = sessionData.session;

    next();
  } catch (error) {
    console.error("Better auth middleware error:", error);
    return res.status(500).json({
      error: "Authentication error",
      message: "Failed to verify authentication",
    });
  }
};
