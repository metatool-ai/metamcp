import { NextFunction, Request, Response } from "express";

import { oauthRequestLogsRepository } from "../../db/repositories";

/**
 * Middleware to log OAuth requests and responses
 * Captures request details, response status, and timing
 */
export const oauthLoggingMiddleware = (requestType: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Extract request details
    const clientId = (req.query.client_id || req.body?.client_id) as
      | string
      | undefined;
    const userId = (req as any).user?.id as string | undefined;

    // Store original res.json to intercept response
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    let responseBody: any = null;
    let responseSent = false;

    // Intercept res.json
    res.json = function (body: any) {
      if (!responseSent) {
        responseBody = body;
        responseSent = true;
      }
      return originalJson(body);
    };

    // Intercept res.send
    res.send = function (body: any) {
      if (!responseSent) {
        try {
          responseBody = typeof body === "string" ? JSON.parse(body) : body;
        } catch {
          responseBody = { raw: body };
        }
        responseSent = true;
      }
      return originalSend(body);
    };

    // Log after response is sent
    res.on("finish", async () => {
      const duration = Date.now() - startTime;

      try {
        // Sanitize headers - remove sensitive data
        const sanitizedHeaders: Record<string, string> = {};
        Object.keys(req.headers).forEach((key) => {
          const lowerKey = key.toLowerCase();
          // Skip sensitive headers
          if (
            !lowerKey.includes("authorization") &&
            !lowerKey.includes("cookie") &&
            !lowerKey.includes("token")
          ) {
            const value = req.headers[key];
            sanitizedHeaders[key] =
              typeof value === "string" ? value : JSON.stringify(value);
          }
        });

        // Sanitize request body - remove sensitive fields
        let sanitizedBody: Record<string, any> | null = null;
        if (req.body && typeof req.body === "object") {
          sanitizedBody = { ...req.body };
          // Remove sensitive fields
          delete sanitizedBody.client_secret;
          delete sanitizedBody.password;
          delete sanitizedBody.code_verifier;
        }

        // Extract error message from response if present
        let errorMessage: string | null = null;
        if (res.statusCode >= 400 && responseBody) {
          errorMessage =
            responseBody.error_description ||
            responseBody.error ||
            responseBody.message ||
            null;
        }

        // Log to database
        await oauthRequestLogsRepository.create({
          client_id: clientId || null,
          user_id: userId || null,
          request_type: requestType,
          request_method: req.method,
          request_path: req.path,
          request_query:
            Object.keys(req.query).length > 0
              ? (req.query as Record<string, string>)
              : {},
          request_headers: sanitizedHeaders || {},
          request_body: sanitizedBody || {},
          response_status: res.statusCode.toString(),
          response_body: responseBody || {},
          error_message: errorMessage,
          ip_address:
            (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
            req.socket.remoteAddress ||
            null,
          user_agent: req.headers["user-agent"] || null,
          duration_ms: duration.toString(),
        });
      } catch (error) {
        // Don't fail the request if logging fails
        console.error("Failed to log OAuth request:", error);
      }
    });

    next();
  };
};

/**
 * Specific middleware instances for different OAuth endpoints
 */
export const logAuthorizationRequest = oauthLoggingMiddleware("authorization");
export const logTokenRequest = oauthLoggingMiddleware("token");
export const logRefreshRequest = oauthLoggingMiddleware("refresh");
export const logUserInfoRequest = oauthLoggingMiddleware("userinfo");
export const logRegistrationRequest = oauthLoggingMiddleware("registration");
export const logMetadataRequest = oauthLoggingMiddleware("metadata");
