// Main entry point for OpenAPI router module
export { default as openApiRouter } from "./routes";

// Export utilities for potential reuse
export { generateOpenApiSchema } from "./schema-generator";
export { executeToolWithMiddleware } from "./tool-execution";
export { createMiddlewareEnabledHandlers } from "./handlers";
export { lookupEndpoint } from "../../../middleware/lookup-endpoint-middleware";
export * from "./types";
