import cors from "cors";
import express from "express";

import { endpointsRepository } from "../db/repositories/endpoints.repo";
import { openApiRouter } from "./public-metamcp/openapi";
import sseRouter from "./public-metamcp/sse";
import streamableHttpRouter from "./public-metamcp/streamable-http";

const publicEndpointsRouter = express.Router();

// Enable CORS for all public endpoint routes
publicEndpointsRouter.use(
  cors({
    origin: true, // Allow all origins
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "mcp-session-id",
      "Authorization",
      "X-API-Key",
    ],
  }),
);

// JSON parsing middleware specifically for OpenAPI routes that need it
publicEndpointsRouter.use((req, res, next) => {
  // Only apply JSON parsing for OpenAPI tool execution endpoints
  if (req.path.includes("/api/tools/") && req.method === "POST") {
    return express.json({ limit: "50mb" })(req, res, next);
  }
  next();
});

// Use StreamableHTTP router for /mcp routes
publicEndpointsRouter.use(streamableHttpRouter);

// Use SSE router for /sse and /message routes
publicEndpointsRouter.use(sseRouter);

// Use OpenAPI router for /api and /openapi.json routes
publicEndpointsRouter.use(openApiRouter);

// Health check endpoint
publicEndpointsRouter.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "public-endpoints",
  });
});

// List all available public endpoints
publicEndpointsRouter.get("/", async (req, res) => {
  try {
    const endpoints = await endpointsRepository.findAllWithNamespaces();
    const publicEndpoints = endpoints.map((endpoint) => ({
      name: endpoint.name,
      description: endpoint.description,
      namespace: endpoint.namespace.name,
      endpoints: {
        mcp: `/metamcp/${endpoint.name}/mcp`,
        sse: `/metamcp/${endpoint.name}/sse`,
        api: `/metamcp/${endpoint.name}/api`,
        openapi: `/metamcp/${endpoint.name}/api/openapi.json`,
      },
    }));

    res.json({
      service: "public-endpoints",
      version: "1.0.0",
      description: "Public MetaMCP endpoints",
      endpoints: publicEndpoints,
    });
  } catch (error) {
    console.error("Error listing public endpoints:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to list endpoints",
    });
  }
});

export default publicEndpointsRouter;
