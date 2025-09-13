import { z } from "zod";

// Import format schemas
export const RestApiImportFormatEnum = z.enum(["manual", "openapi", "simple_json"]);

// Simple JSON import format (user-friendly)
export const SimpleJsonApiSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  base_url: z.string().url(),
  auth: z.object({
    type: z.enum(["none", "bearer", "api_key", "basic"]).default("none"),
    token: z.string().optional(),
    key: z.string().optional(),
    location: z.enum(["header", "query"]).optional(),
    name: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional(),
  endpoints: z.array(z.object({
    name: z.string(),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
    path: z.string(),
    description: z.string().optional(),
    parameters: z.array(z.object({
      name: z.string(),
      in: z.enum(["path", "query", "header"]),
      type: z.enum(["string", "number", "boolean", "array"]),
      required: z.boolean().optional().default(false),
      description: z.string().optional(),
      default: z.any().optional(),
      enum: z.array(z.string()).optional(),
    })).optional().default([]),
    requestBody: z.object({
      contentType: z.string().default("application/json"),
      required: z.boolean().optional().default(false),
      schema: z.any().optional(),
    }).optional(),
    responses: z.array(z.object({
      statusCode: z.number(),
      description: z.string().optional(),
      schema: z.any().optional(),
    })).optional().default([]),
    headers: z.record(z.string()).optional().default({}),
  })),
});

// OpenAPI 3.0+ import schema (simplified for our needs)
export const OpenApiParameterSchema = z.object({
  name: z.string(),
  in: z.enum(["query", "header", "path", "cookie"]),
  description: z.string().optional(),
  required: z.boolean().optional(),
  schema: z.object({
    type: z.string(),
    format: z.string().optional(),
    enum: z.array(z.any()).optional(),
    default: z.any().optional(),
  }).optional(),
});

export const OpenApiRequestBodySchema = z.object({
  description: z.string().optional(),
  content: z.record(z.object({
    schema: z.any().optional(),
  })),
  required: z.boolean().optional(),
});

export const OpenApiResponseSchema = z.object({
  description: z.string(),
  content: z.record(z.object({
    schema: z.any().optional(),
  })).optional(),
});

export const OpenApiOperationSchema = z.object({
  operationId: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  parameters: z.array(OpenApiParameterSchema).optional(),
  requestBody: OpenApiRequestBodySchema.optional(),
  responses: z.record(OpenApiResponseSchema),
});

export const OpenApiPathItemSchema = z.object({
  get: OpenApiOperationSchema.optional(),
  post: OpenApiOperationSchema.optional(),
  put: OpenApiOperationSchema.optional(),
  delete: OpenApiOperationSchema.optional(),
  patch: OpenApiOperationSchema.optional(),
  parameters: z.array(OpenApiParameterSchema).optional(),
});

export const OpenApiSecuritySchemeSchema = z.object({
  type: z.enum(["apiKey", "http", "oauth2", "openIdConnect"]),
  description: z.string().optional(),
  name: z.string().optional(), // for apiKey
  in: z.enum(["query", "header", "cookie"]).optional(), // for apiKey
  scheme: z.string().optional(), // for http (bearer, basic, etc.)
  bearerFormat: z.string().optional(), // for http bearer
});

export const OpenApiInfoSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  version: z.string(),
});

export const OpenApiServerSchema = z.object({
  url: z.string(),
  description: z.string().optional(),
});

export const OpenApiSpecSchema = z.object({
  openapi: z.string(),
  info: OpenApiInfoSchema,
  servers: z.array(OpenApiServerSchema).optional(),
  paths: z.record(OpenApiPathItemSchema),
  components: z.object({
    securitySchemes: z.record(OpenApiSecuritySchemeSchema).optional(),
    schemas: z.record(z.any()).optional(),
  }).optional(),
  security: z.array(z.record(z.array(z.string()))).optional(),
});

// Manual entry form schema
export const ManualEndpointFormSchema = z.object({
  name: z.string().min(1, "Endpoint name is required"),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  path: z.string().min(1, "Path is required"),
  description: z.string().optional(),
  parameters_json: z.string().optional(), // JSON string of parameters
  request_body_json: z.string().optional(), // JSON string of request body
  responses_json: z.string().optional(), // JSON string of responses
  headers_json: z.string().optional(), // JSON string of headers
});

export const ManualApiFormSchema = z.object({
  name: z.string().min(1, "API name is required"),
  description: z.string().optional(),
  base_url: z.string().url("Valid base URL is required"),
  auth_type: z.enum(["none", "bearer", "api_key", "basic"]).default("none"),
  auth_token: z.string().optional(),
  auth_key: z.string().optional(),
  auth_key_location: z.enum(["header", "query"]).optional(),
  auth_key_name: z.string().optional(),
  auth_username: z.string().optional(),
  auth_password: z.string().optional(),
  endpoints: z.array(ManualEndpointFormSchema).min(1, "At least one endpoint is required"),
});

// REST API import request schema
export const RestApiImportRequestSchema = z.object({
  format: RestApiImportFormatEnum,
  data: z.union([
    SimpleJsonApiSchema,
    OpenApiSpecSchema,
    ManualApiFormSchema,
  ]),
  server_name: z.string().min(1, "Server name is required"),
  server_description: z.string().optional(),
  user_id: z.string().nullable().optional(),
});

// REST API import response schema
export const RestApiImportResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    server_uuid: z.string(),
    endpoints_count: z.number(),
    tools_generated: z.array(z.string()),
  }).optional(),
  message: z.string().optional(),
});

// Utility schemas for validation
export const ValidateApiSpecRequestSchema = z.object({
  format: RestApiImportFormatEnum,
  data: z.union([
    SimpleJsonApiSchema,
    OpenApiSpecSchema,
    ManualApiFormSchema,
  ]),
});

export const ValidateApiSpecResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    endpoints_count: z.number(),
    endpoints_preview: z.array(z.object({
      name: z.string(),
      method: z.string(),
      path: z.string(),
      description: z.string().optional(),
    })),
    warnings: z.array(z.string()).optional(),
  }).optional(),
  message: z.string().optional(),
});

// Types
export type RestApiImportFormat = z.infer<typeof RestApiImportFormatEnum>;
export type SimpleJsonApi = z.infer<typeof SimpleJsonApiSchema>;
export type OpenApiSpec = z.infer<typeof OpenApiSpecSchema>;
export type ManualApiForm = z.infer<typeof ManualApiFormSchema>;
export type ManualEndpointForm = z.infer<typeof ManualEndpointFormSchema>;
export type RestApiImportRequest = z.infer<typeof RestApiImportRequestSchema>;
export type RestApiImportResponse = z.infer<typeof RestApiImportResponseSchema>;
export type ValidateApiSpecRequest = z.infer<typeof ValidateApiSpecRequestSchema>;
export type ValidateApiSpecResponse = z.infer<typeof ValidateApiSpecResponseSchema>;
