import { ApiKeyAuthenticatedRequest } from "@/middleware/api-key-oauth.middleware";

export interface ToolExecutionRequest extends ApiKeyAuthenticatedRequest {
  params: { tool_name: string };
}

export interface OpenApiSchema {
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
  };
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, unknown>;
  };
}
