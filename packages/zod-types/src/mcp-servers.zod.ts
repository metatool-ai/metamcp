import { z } from "zod";

export const McpServerTypeEnum = z.enum(["STDIO", "SSE", "STREAMABLE_HTTP"]);
export const McpServerStatusEnum = z.enum(["ACTIVE", "INACTIVE"]);

export const McpServerErrorStatusEnum = z.enum(["NONE", "ERROR"]);

/**
 * RFC 7230 token characters for HTTP header field names.
 * Valid: letters, digits, and !#$%&'*+-.^_`|~
 */
const HTTP_HEADER_NAME_REGEX = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;

/**
 * Headers that must never be forwarded to backend servers.
 * Shared between Zod validation (reject at save time) and runtime filtering.
 */
export const DENIED_FORWARD_HEADERS = new Set([
  "host",
  "cookie",
  "set-cookie",
  "connection",
  "transfer-encoding",
  "content-length",
  "content-encoding",
  "te",
  "trailer",
  "upgrade",
  "keep-alive",
  "proxy-authorization",
  "proxy-authenticate",
  "proxy-connection",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "mcp-session-id",
]);

/**
 * Header name prefixes that are always denied.
 * - `proxy-` covers all proxy-related headers
 * - `sec-` covers browser-controlled Fetch Metadata headers
 */
export const DENIED_HEADER_PREFIXES = ["proxy-", "sec-"];

/** Check whether a header name is denied (exact or prefix match) */
function isDeniedHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    DENIED_FORWARD_HEADERS.has(lower) ||
    DENIED_HEADER_PREFIXES.some((p) => lower.startsWith(p))
  );
}

/** Reusable Zod schema for a single HTTP header name */
const httpHeaderName = z
  .string()
  .min(1, "Header name cannot be empty")
  .regex(HTTP_HEADER_NAME_REGEX, "Invalid HTTP header name");

/**
 * Validated Record mapping client header names to server header names.
 * Keys are validated against the deny-list; values are free-form header names.
 */
export const ForwardHeadersRecordSchema = z
  .record(httpHeaderName, httpHeaderName)
  .refine(
    (rec) => Object.keys(rec).length <= 50,
    "Too many forward headers (max 50)",
  )
  .refine(
    (rec) => Object.keys(rec).every((k) => !isDeniedHeader(k)),
    "Forbidden header name in keys",
  )
  .optional();

/**
 * Validated forward_headers from a form textarea (newline-separated string).
 * Each line is either:
 *  - `HeaderName` (1:1 mapping, shorthand for HeaderName=HeaderName)
 *  - `ClientHeader=ServerHeader` (rename mapping)
 */
export const ForwardHeadersFormSchema = z
  .string()
  .optional()
  .refine(
    (val) => {
      if (!val || val.trim() === "") return true;
      const lines = val
        .trim()
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      return lines.every((line) => {
        const eqIdx = line.indexOf("=");
        if (eqIdx === -1) {
          // Bare name: must be valid header and not denied
          return HTTP_HEADER_NAME_REGEX.test(line) && !isDeniedHeader(line);
        }
        const clientName = line.slice(0, eqIdx).trim();
        const serverName = line.slice(eqIdx + 1).trim();
        return (
          HTTP_HEADER_NAME_REGEX.test(clientName) &&
          !isDeniedHeader(clientName) &&
          HTTP_HEADER_NAME_REGEX.test(serverName)
        );
      });
    },
    { message: "validation:forwardHeaders.invalidHeaderName" },
  );

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
    headers: z.string().optional(),
    forward_headers: ForwardHeadersFormSchema,
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
    headers: z.string().optional(),
    forward_headers: ForwardHeadersFormSchema,
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
    headers: z.record(z.string()).optional(),
    forward_headers: ForwardHeadersRecordSchema,
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
  headers: z.record(z.string()),
  forward_headers: z.record(z.string()),
  user_id: z.string().nullable(),
  error_status: McpServerErrorStatusEnum.optional(),
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
    headers: z.record(z.string()).optional(),
    forward_headers: ForwardHeadersRecordSchema,
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
    headers: z.record(z.string()).optional(),
    forward_headers: ForwardHeadersRecordSchema,
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
  headers: z.record(z.string()).optional(),
  forward_headers: ForwardHeadersRecordSchema,
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
  headers: z.record(z.string()).optional(),
  forward_headers: ForwardHeadersRecordSchema,
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
  headers: z.record(z.string()),
  forward_headers: z.record(z.string()),
  user_id: z.string().nullable(),
});

export type DatabaseMcpServer = z.infer<typeof DatabaseMcpServerSchema>;
