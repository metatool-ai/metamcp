import { z } from "zod";

export const McpServerTypeEnum = z.enum(["STDIO", "SSE", "STREAMABLE_HTTP", "REST_API"]);
export const McpServerStatusEnum = z.enum(["ACTIVE", "INACTIVE"]);

export const McpServerErrorStatusEnum = z.enum(["NONE", "ERROR"]);

// JSON Schema type for better type safety
export const JsonSchemaPropertySchema: z.ZodType<{
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  default?: string | number | boolean | any[] | Record<string, any>;
  enum?: (string | number)[];
  format?: string;
  items?: any;
  properties?: Record<string, any>;
  required?: string[];
}> = z.object({
  type: z.enum(["string", "number", "integer", "boolean", "array", "object"]),
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.any()), z.object({})]).optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
  format: z.string().optional(),
  items: z.lazy(() => JsonSchemaPropertySchema).optional(),
  properties: z.record(z.lazy(() => JsonSchemaPropertySchema)).optional(),
  required: z.array(z.string()).optional(),
});

export const JsonSchemaSchema = z.object({
  type: z.literal("object"),
  properties: z.record(JsonSchemaPropertySchema).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});

// REST API specific schemas
export const RestApiParameterSchema = z.object({
  name: z.string(),
  in: z.enum(["path", "query", "header"]),
  type: z.enum(["string", "number", "boolean", "array"]),
  required: z.boolean().optional().default(false),
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.any())]).optional(),
  enum: z.array(z.string()).optional(),
});

export const RestApiRequestBodySchema = z.object({
  contentType: z.string().default("application/json"),
  schema: z.any().optional(), // JSON schema for validation
  required: z.boolean().optional().default(false),
});

export const RestApiResponseSchema = z.object({
  statusCode: z.number(),
  description: z.string().optional(),
  schema: z.any().optional(), // JSON schema for response
});

export const RestApiEndpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  path: z.string(),
  parameters: z.array(RestApiParameterSchema).optional().default([]),
  requestBody: RestApiRequestBodySchema.optional(),
  responses: z.array(RestApiResponseSchema).optional().default([]),
  headers: z.record(z.string()).optional().default({}),
});

export const AuthConfigurationSchema = z.object({
  type: z.enum(["none", "bearer", "api_key", "basic"]).default("none"),
  config: z.object({
    // For bearer token
    token: z.string().optional(),

    // For API key
    key: z.string().optional(),
    location: z.enum(["header", "query"]).optional(),
    name: z.string().optional(), // Header/query parameter name

    // For basic auth
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional(),
});

export const RestApiSpecificationSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional().default("1.0.0"),
  endpoints: z.array(RestApiEndpointSchema),
});

// Types
export type RestApiParameter = z.infer<typeof RestApiParameterSchema>;
export type RestApiRequestBody = z.infer<typeof RestApiRequestBodySchema>;
export type RestApiResponse = z.infer<typeof RestApiResponseSchema>;
export type RestApiEndpoint = z.infer<typeof RestApiEndpointSchema>;
export type AuthConfiguration = z.infer<typeof AuthConfigurationSchema>;
export type RestApiSpecification = z.infer<typeof RestApiSpecificationSchema>;

// Define the form schema (includes UI-specific fields)
export const createServerFormSchema = z
  .object({
    name: z
      .string()
      .min(1, "validation:serverName.required")
      .regex(/^[a-zA-Z0-9_-]+$/, "validation:serverName.invalidCharacters")
      .refine(
        (value) => !/_{2,}/.test(value),
        "validation:serverName.consecutiveUnderscores",
      ),
    description: z.string().optional(),
    type: McpServerTypeEnum,
    command: z.string().optional(),
    args: z.string().optional(),
    url: z.string().optional(),
    bearerToken: z.string().optional(),
    env: z.string().optional(),
    user_id: z.string().nullable().optional(),
    // REST API specific fields (as strings for form handling)
    api_spec_json: z.string().optional(), // JSON string representation
    base_url: z.string().optional(),
    auth_type: z.enum(["none", "bearer", "api_key", "basic"]).optional(),
    auth_token: z.string().optional(),
    auth_key: z.string().optional(),
    auth_key_location: z.enum(["header", "query"]).optional(),
    auth_key_name: z.string().optional(),
    auth_username: z.string().optional(),
    auth_password: z.string().optional(),
  })
  .refine(
    (data) => {
      // Command is required for stdio type
      if (data.type === McpServerTypeEnum.Enum.STDIO) {
        return data.command && data.command.trim() !== "";
      }
      return true;
    },
    {
      message: "validation:command.required",
      path: ["command"],
    },
  )
  .refine(
    (data) => {
      // URL is required for SSE and Streamable HTTP types
      if (
        data.type === McpServerTypeEnum.Enum.SSE ||
        data.type === McpServerTypeEnum.Enum.STREAMABLE_HTTP
      ) {
        if (!data.url || data.url.trim() === "") {
          return false;
        }
        // Validate URL format
        try {
          new URL(data.url);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: "validation:url.required",
      path: ["url"],
    },
  );

export type CreateServerFormData = z.infer<typeof createServerFormSchema>;

// Form schema for editing servers
export const EditServerFormSchema = z
  .object({
    name: z
      .string()
      .min(1, "validation:serverName.required")
      .regex(/^[a-zA-Z0-9_-]+$/, "validation:serverName.invalidCharacters")
      .refine(
        (value) => !/_{2,}/.test(value),
        "validation:serverName.consecutiveUnderscores",
      ),
    description: z.string().optional(),
    type: McpServerTypeEnum,
    command: z.string().optional(),
    args: z.string().optional(),
    url: z.string().optional(),
    bearerToken: z.string().optional(),
    env: z.string().optional(),
    user_id: z.string().nullable().optional(),
  })
  .refine(
    (data) => {
      // Command is required for stdio type
      if (data.type === McpServerTypeEnum.Enum.STDIO) {
        return data.command && data.command.trim() !== "";
      }
      return true;
    },
    {
      message: "validation:command.required",
      path: ["command"],
    },
  )
  .refine(
    (data) => {
      // URL is required for SSE and Streamable HTTP types
      if (
        data.type === McpServerTypeEnum.Enum.SSE ||
        data.type === McpServerTypeEnum.Enum.STREAMABLE_HTTP
      ) {
        if (!data.url || data.url.trim() === "") {
          return false;
        }
        // Validate URL format
        try {
          new URL(data.url);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: "validation:url.required",
      path: ["url"],
    },
  );

export type EditServerFormData = z.infer<typeof EditServerFormSchema>;

export const CreateMcpServerRequestSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        "Server name must only contain letters, numbers, underscores, and hyphens",
      )
      .refine(
        (value) => !/_{2,}/.test(value),
        "Server name cannot contain consecutive underscores",
      ),
    description: z.string().optional(),
    type: McpServerTypeEnum,
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    bearerToken: z.string().optional(),
    user_id: z.string().nullable().optional(),
    // REST API specific fields
    api_spec: RestApiSpecificationSchema.optional(),
    base_url: z.string().optional(),
    auth_config: AuthConfigurationSchema.optional(),
  })
  .refine(
    (data) => {
      // For stdio type, command is required
      if (data.type === "STDIO") {
        return data.command && data.command.trim() !== "";
      }

      // For REST_API type, base_url and api_spec are required
      if (data.type === "REST_API") {
        if (!data.base_url || data.base_url.trim() === "") {
          return false;
        }
        if (!data.api_spec || !data.api_spec.endpoints || data.api_spec.endpoints.length === 0) {
          return false;
        }
        try {
          new URL(data.base_url);
          return true;
        } catch {
          return false;
        }
      }

      // For SSE and STREAMABLE_HTTP types, URL should be provided and valid
      if (data.type === "SSE" || data.type === "STREAMABLE_HTTP") {
        if (!data.url || data.url.trim() === "") {
          return false;
        }
        try {
          new URL(data.url);
          return true;
        } catch {
          return false;
        }
      }

      return true;
    },
    {
      message:
        "Command is required for STDIO. URL is required for SSE/STREAMABLE_HTTP. base_url and api_spec are required for REST_API.",
    },
  );

export const McpServerSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: McpServerTypeEnum,
  command: z.string().nullable(),
  args: z.array(z.string()),
  env: z.record(z.string()),
  url: z.string().nullable(),
  created_at: z.string(),
  bearerToken: z.string().nullable(),
  user_id: z.string().nullable(),
  error_status: McpServerErrorStatusEnum.optional(),
  // REST API specific fields
  api_spec: RestApiSpecificationSchema.nullable().optional(),
  base_url: z.string().nullable().optional(),
  auth_config: AuthConfigurationSchema.nullable().optional(),
});

export const CreateMcpServerResponseSchema = z.object({
  success: z.boolean(),
  data: McpServerSchema.optional(),
  message: z.string().optional(),
});

export const ListMcpServersResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(McpServerSchema),
  message: z.string().optional(),
});

export const GetMcpServerResponseSchema = z.object({
  success: z.boolean(),
  data: McpServerSchema.optional(),
  message: z.string().optional(),
});

// Bulk import schemas
export const BulkImportMcpServerSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    description: z.string().optional(),
    type: z
      .string()
      .optional()
      .transform((val) => {
        if (!val) return undefined;
        // Convert to uppercase for case-insensitive matching
        const upperVal = val.toUpperCase();
        // Map common variations to the correct enum values
        if (upperVal === "STDIO" || upperVal === "STD") return "STDIO";
        if (upperVal === "SSE") return "SSE";
        if (
          upperVal === "STREAMABLE_HTTP" ||
          upperVal === "STREAMABLEHTTP" ||
          upperVal === "HTTP"
        )
          return "STREAMABLE_HTTP";
        return upperVal; // Return as-is if it doesn't match known patterns
      })
      .pipe(McpServerTypeEnum.optional()),
  })
  .refine(
    (data) => {
      const serverType = data.type || McpServerTypeEnum.Enum.STDIO;

      // For STDIO type, URL can be empty
      if (serverType === McpServerTypeEnum.Enum.STDIO) {
        return true;
      }

      // For other types, URL should be provided and valid
      if (!data.url || data.url.trim() === "") {
        return false;
      }

      try {
        new URL(data.url);
        return true;
      } catch {
        return false;
      }
    },
    {
      message:
        "URL is required and must be valid for sse and streamable_http server types",
      path: ["url"],
    },
  );

export const BulkImportMcpServersRequestSchema = z.object({
  mcpServers: z.record(BulkImportMcpServerSchema),
});

export const BulkImportMcpServersResponseSchema = z.object({
  success: z.boolean(),
  imported: z.number(),
  errors: z.array(z.string()).optional(),
  message: z.string().optional(),
});

// MCP Server types
export type McpServerType = z.infer<typeof McpServerTypeEnum>;
export type CreateMcpServerRequest = z.infer<
  typeof CreateMcpServerRequestSchema
>;
export type McpServer = z.infer<typeof McpServerSchema>;
export type CreateMcpServerResponse = z.infer<
  typeof CreateMcpServerResponseSchema
>;
export type ListMcpServersResponse = z.infer<
  typeof ListMcpServersResponseSchema
>;
export type GetMcpServerResponse = z.infer<typeof GetMcpServerResponseSchema>;
export type BulkImportMcpServer = z.infer<typeof BulkImportMcpServerSchema>;
export type BulkImportMcpServersRequest = z.infer<
  typeof BulkImportMcpServersRequestSchema
>;
export type BulkImportMcpServersResponse = z.infer<
  typeof BulkImportMcpServersResponseSchema
>;

export const DeleteMcpServerRequestSchema = z.object({
  uuid: z.string().uuid(),
});

export const DeleteMcpServerResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
});

export const UpdateMcpServerRequestSchema = z
  .object({
    uuid: z.string().uuid(),
    name: z
      .string()
      .min(1, "Name is required")
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        "Server name must only contain letters, numbers, underscores, and hyphens",
      )
      .refine(
        (value) => !/_{2,}/.test(value),
        "Server name cannot contain consecutive underscores",
      ),
    description: z.string().optional(),
    type: McpServerTypeEnum,
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    bearerToken: z.string().optional(),
    user_id: z.string().nullable().optional(),
  })
  .refine(
    (data) => {
      // For stdio type, command is required and URL should be empty
      if (data.type === "STDIO") {
        return data.command && data.command.trim() !== "";
      }

      // For other types, URL should be provided and valid
      if (!data.url || data.url.trim() === "") {
        return false;
      }

      try {
        new URL(data.url);
        return true;
      } catch {
        return false;
      }
    },
    {
      message:
        "Command is required for stdio servers. URL is required and must be valid for sse and streamable_http server types",
    },
  );

export const UpdateMcpServerResponseSchema = z.object({
  success: z.boolean(),
  data: McpServerSchema.optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

export type DeleteMcpServerRequest = z.infer<
  typeof DeleteMcpServerRequestSchema
>;

export type DeleteMcpServerResponse = z.infer<
  typeof DeleteMcpServerResponseSchema
>;

export type UpdateMcpServerRequest = z.infer<
  typeof UpdateMcpServerRequestSchema
>;

export type UpdateMcpServerResponse = z.infer<
  typeof UpdateMcpServerResponseSchema
>;

// Repository-specific schemas
export const McpServerCreateInputSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Server name must only contain letters, numbers, underscores, and hyphens",
    )
    .refine(
      (value) => !/_{2,}/.test(value),
      "Server name cannot contain consecutive underscores",
    ),
  description: z.string().nullable().optional(),
  type: McpServerTypeEnum,
  command: z.string().nullable().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().nullable().optional(),
  bearerToken: z.string().nullable().optional(),
  user_id: z.string().nullable().optional(),
});

export const McpServerUpdateInputSchema = z.object({
  uuid: z.string(),
  name: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Server name must only contain letters, numbers, underscores, and hyphens",
    )
    .refine(
      (value) => !/_{2,}/.test(value),
      "Server name cannot contain consecutive underscores",
    )
    .optional(),
  description: z.string().nullable().optional(),
  type: McpServerTypeEnum.optional(),
  command: z.string().nullable().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().nullable().optional(),
  bearerToken: z.string().nullable().optional(),
  user_id: z.string().nullable().optional(),
});

export type McpServerCreateInput = z.infer<typeof McpServerCreateInputSchema>;
export type McpServerUpdateInput = z.infer<typeof McpServerUpdateInputSchema>;

// Database-specific schemas (raw database results with Date objects)
export const DatabaseMcpServerSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: McpServerTypeEnum,
  command: z.string().nullable(),
  args: z.array(z.string()),
  env: z.record(z.string()),
  url: z.string().nullable(),
  error_status: McpServerErrorStatusEnum,
  created_at: z.date(),
  bearerToken: z.string().nullable(),
  user_id: z.string().nullable(),
  // REST API specific fields
  api_spec: z.any().nullable().optional(), // Will be parsed as RestApiSpecificationSchema when needed
  base_url: z.string().nullable().optional(),
  auth_config: z.any().nullable().optional(), // Will be parsed as AuthConfigurationSchema when needed
});

export type DatabaseMcpServer = z.infer<typeof DatabaseMcpServerSchema>;

// Additional type exports for better type safety
export type JsonSchemaProperty = z.infer<typeof JsonSchemaPropertySchema>;
export type JsonSchema = z.infer<typeof JsonSchemaSchema>;
