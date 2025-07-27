import { z } from "zod";

export const McpServerTypeEnum = z.enum(["STDIO", "SSE", "STREAMABLE_HTTP"]);
export const McpServerStatusEnum = z.enum(["ACTIVE", "INACTIVE"]);

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
  created_at: z.date(),
  bearerToken: z.string().nullable(),
  user_id: z.string().nullable(),
});

export type DatabaseMcpServer = z.infer<typeof DatabaseMcpServerSchema>;
