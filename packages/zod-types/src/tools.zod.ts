import { z } from "zod";

// Define tool-specific status enum
export const ToolStatusEnum = z.enum(["ACTIVE", "INACTIVE"]);
export type ToolStatus = z.infer<typeof ToolStatusEnum>;

// Define tool access type enum
export const ToolAccessTypeEnum = z.enum(["read", "write"]);
export type ToolAccessType = z.infer<typeof ToolAccessTypeEnum>;

// Tool schema
export const ToolSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  toolSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.any()).optional(),
    required: z.array(z.string()).optional(),
  }),
  access_type: ToolAccessTypeEnum.default("write"),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  mcp_server_uuid: z.string().uuid(),
});

export type Tool = z.infer<typeof ToolSchema>;

// Get tools by MCP server UUID
export const GetToolsByMcpServerUuidRequestSchema = z.object({
  mcpServerUuid: z.string().uuid(),
});

export const GetToolsByMcpServerUuidResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(ToolSchema),
  message: z.string().optional(),
});

// Save tools to database
export const CreateToolRequestSchema = z.object({
  mcpServerUuid: z.string().uuid(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      inputSchema: z.object({
        type: z.literal("object").optional(),
        properties: z.record(z.any()).optional(),
        required: z.array(z.string()).optional(),
      }),
    }),
  ),
});

export const CreateToolResponseSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  message: z.string().optional(),
  error: z.string().optional(),
});

// Export types
export type GetToolsByMcpServerUuidRequest = z.infer<
  typeof GetToolsByMcpServerUuidRequestSchema
>;
export type GetToolsByMcpServerUuidResponse = z.infer<
  typeof GetToolsByMcpServerUuidResponseSchema
>;

export type CreateToolRequest = z.infer<typeof CreateToolRequestSchema>;
export type CreateToolResponse = z.infer<typeof CreateToolResponseSchema>;

// Repository-specific schemas
export const ToolCreateInputSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  toolSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.any()).optional(),
    required: z.array(z.string()).optional(),
  }),
  access_type: ToolAccessTypeEnum.default("write"),
  mcp_server_uuid: z.string(),
});

export const ToolUpsertInputSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable().optional(),
      inputSchema: z
        .object({
          properties: z.record(z.any()).optional(),
          required: z.array(z.string()).optional(),
        })
        .optional(),
    }),
  ),
  mcpServerUuid: z.string(),
});

export type ToolCreateInput = z.infer<typeof ToolCreateInputSchema>;
export type ToolUpsertInput = z.infer<typeof ToolUpsertInputSchema>;

// Database-specific schemas (raw database results with Date objects)
export const DatabaseToolSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  toolSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.any()).optional(),
    required: z.array(z.string()).optional(),
  }),
  access_type: ToolAccessTypeEnum.default("write"),
  created_at: z.date(),
  updated_at: z.date(),
  mcp_server_uuid: z.string(),
});

export type DatabaseTool = z.infer<typeof DatabaseToolSchema>;

// Update tool access type
export const UpdateToolAccessTypeRequestSchema = z.object({
  toolUuid: z.string().uuid(),
  accessType: ToolAccessTypeEnum,
});

export const UpdateToolAccessTypeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

export type UpdateToolAccessTypeRequest = z.infer<
  typeof UpdateToolAccessTypeRequestSchema
>;
export type UpdateToolAccessTypeResponse = z.infer<
  typeof UpdateToolAccessTypeResponseSchema
>;
