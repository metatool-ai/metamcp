import { type BaseContext, createHeadlessAppRouter } from "@repo/trpc";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { generateOpenApiDocument } from "trpc-to-openapi";
import { createOpenApiExpressMiddleware } from "trpc-to-openapi";

import { authenticateAdminApiKey } from "../middleware/admin-auth.middleware";
import { headlessMcpServersImplementations } from "../trpc/headless-mcp-servers.impl";

/**
 * TRPCError to HTTP Status Code Mapping:
 *
 * TRPCError codes are automatically mapped to HTTP status codes by tRPC-to-OpenAPI:
 * - BAD_REQUEST          → 400 (Invalid input parameters)
 * - UNAUTHORIZED         → 401 (Invalid or missing API key)
 * - FORBIDDEN            → 403 (Access denied)
 * - NOT_FOUND            → 404 (Resource not found)
 * - METHOD_NOT_SUPPORTED → 405 (HTTP method not allowed)
 * - TIMEOUT              → 408 (Request timeout)
 * - CONFLICT             → 409 (Resource already exists/conflicts)
 * - PRECONDITION_FAILED  → 412 (Precondition not met)
 * - PAYLOAD_TOO_LARGE    → 413 (Request too large)
 * - UNPROCESSABLE_CONTENT → 422 (Valid but unprocessable)
 * - TOO_MANY_REQUESTS    → 429 (Rate limit exceeded)
 * - CLIENT_CLOSED_REQUEST → 499 (Client closed connection)
 * - INTERNAL_SERVER_ERROR → 500 (Unexpected server error)
 *
 * Usage in implementations:
 * throw new TRPCError({ code: "NOT_FOUND", message: "Resource not found" });
 */

// Create the standalone headless app router
const headlessAppRouter = createHeadlessAppRouter({
  mcpServers: headlessMcpServersImplementations,
});

// Generate OpenAPI document
const openApiDocument = generateOpenApiDocument(headlessAppRouter, {
  title: "MetaMCP Headless API",
  description: "Admin API for managing MetaMCP resources programmatically",
  version: "1.0.0",
  baseUrl: `${process.env.APP_URL}/api/headless`,
  tags: ["MCP Servers"],
});

// Create Express router for headless API
const headlessApiRouter = express.Router();

// Apply security middleware
headlessApiRouter.use(helmet());

// Enable CORS for all origins (adjust as needed for production)
headlessApiRouter.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  }),
);

// Apply admin API key authentication to all routes
headlessApiRouter.use(authenticateAdminApiKey);

// Mount OpenAPI documentation endpoint (public, but still requires admin key due to middleware above)
headlessApiRouter.get("/openapi.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.status(200).json(openApiDocument);
});

// Mount tRPC-to-OpenAPI middleware for API endpoints
headlessApiRouter.use(
  "/",
  createOpenApiExpressMiddleware({
    router: headlessAppRouter,
    createContext: (): BaseContext => {
      // Return BaseContext compliant object
      return {
        user: undefined,
        session: undefined,
      };
    },
    // Configure response meta to ensure proper HTTP status codes
    responseMeta: ({ type, errors }) => {
      // Handle errors and map them to appropriate HTTP status codes
      if (errors && errors.length > 0) {
        // tRPC-to-OpenAPI should automatically map TRPCError codes to HTTP status codes
        // but we can provide additional customization here if needed
        return {};
      }

      // For successful operations, return appropriate status codes
      if (type === "mutation") {
        // POST/PUT/DELETE operations
        return { status: 200 };
      }

      // GET operations
      return { status: 200 };
    },
    // Configure error handling
    onError: ({ error, type, path, input, req }) => {
      console.error(`❌ Headless API error on ${path ?? "unknown"}:`, {
        error: error.message,
        code: error.code,
        type,
        input,
        userAgent: req.headers["user-agent"],
        ip: req.ip,
      });
    },
  }),
);

export default headlessApiRouter;
