import { z } from "zod";

import {
  McpServerErrorStatusEnum,
  McpServerSchema,
  McpServerStatusEnum,
} from "./mcp-servers.zod";
import { ToolSchema, ToolStatusEnum } from "./tools.zod";

// Namespace schema definitions
export const createNamespaceFormSchema = z.object({
  name: z.string().min(1, "validation:namespaceName.required"),
  description: z.string().optional(),
  mcpServerUuids: z.array(z.string()).optional(),
  user_id: z.string().nullable().optional(),
});

export type CreateNamespaceFormData = z.infer<typeof createNamespaceFormSchema>;

export const editNamespaceFormSchema = z.object({
  name: z.string().min(1, "validation:namespaceName.required"),
  description: z.string().optional(),
  mcpServerUuids: z.array(z.string()).optional(),
  user_id: z.string().nullable().optional(),
});

export type EditNamespaceFormData = z.infer<typeof editNamespaceFormSchema>;

export const CreateNamespaceRequestSchema = z.object({
  name: z.string().min(1, "validation:namespaceName.required"),
  description: z.string().optional(),
  mcpServerUuids: z.array(z.string()).optional(),
  user_id: z.string().nullable().optional(),
});

export const NamespaceSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  user_id: z.string().nullable(),
});

// Server within namespace schema - extends McpServerSchema with namespace-specific status
export const NamespaceServerSchema = McpServerSchema.extend({
  status: McpServerStatusEnum,
  error_status: McpServerErrorStatusEnum.optional(),
});

// Tool within namespace schema - extends ToolSchema with namespace-specific status and server info
export const NamespaceToolSchema = ToolSchema.extend({
  serverName: z.string(),
  serverUuid: z.string(),
  status: ToolStatusEnum, // Status from namespace tool mapping
});

export const NamespaceWithServersSchema = NamespaceSchema.extend({
  servers: z.array(NamespaceServerSchema),
});

export const CreateNamespaceResponseSchema = z.object({
  success: z.boolean(),
  data: NamespaceSchema.optional(),
  message: z.string().optional(),
});

export const ListNamespacesResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(NamespaceSchema),
  message: z.string().optional(),
});

export const GetNamespaceResponseSchema = z.object({
  success: z.boolean(),
  data: NamespaceWithServersSchema.optional(),
  message: z.string().optional(),
});

// Get namespace tools from mapping table
export const GetNamespaceToolsRequestSchema = z.object({
  namespaceUuid: z.string().uuid(),
});

export const GetNamespaceToolsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(NamespaceToolSchema),
  message: z.string().optional(),
});

export const UpdateNamespaceRequestSchema = z.object({
  uuid: z.string(),
  name: z.string().min(1, "validation:namespaceName.required"),
  description: z.string().optional(),
  mcpServerUuids: z.array(z.string()).optional(),
  user_id: z.string().nullable().optional(),
});

export const UpdateNamespaceResponseSchema = z.object({
  success: z.boolean(),
  data: NamespaceSchema.optional(),
  message: z.string().optional(),
});

export const DeleteNamespaceRequestSchema = z.object({
  uuid: z.string(),
});

export const DeleteNamespaceResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

// Namespace server status management schemas
export const UpdateNamespaceServerStatusRequestSchema = z.object({
  namespaceUuid: z.string(),
  serverUuid: z.string(),
  status: McpServerStatusEnum,
});

export const UpdateNamespaceServerStatusResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

// Namespace tool status management schemas
export const UpdateNamespaceToolStatusRequestSchema = z.object({
  namespaceUuid: z.string().uuid(),
  toolUuid: z.string().uuid(),
  serverUuid: z.string().uuid(),
  status: ToolStatusEnum,
});

export const UpdateNamespaceToolStatusResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// Refresh tools from MetaMCP connection
export const RefreshNamespaceToolsRequestSchema = z.object({
  namespaceUuid: z.string().uuid(),
  tools: z.array(
    z.object({
      name: z.string(), // This will contain "ServerName__toolName" format
      description: z.string().optional(),
      inputSchema: z.record(z.any()),
      // Remove serverUuid since we'll resolve it from the tool name
    }),
  ),
});

export const RefreshNamespaceToolsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  toolsCreated: z.number().optional(),
  mappingsCreated: z.number().optional(),
});

// Type exports
export type CreateNamespaceRequest = z.infer<
  typeof CreateNamespaceRequestSchema
>;
export type Namespace = z.infer<typeof NamespaceSchema>;
export type NamespaceServer = z.infer<typeof NamespaceServerSchema>;
export type NamespaceTool = z.infer<typeof NamespaceToolSchema>;
export type NamespaceWithServers = z.infer<typeof NamespaceWithServersSchema>;
export type CreateNamespaceResponse = z.infer<
  typeof CreateNamespaceResponseSchema
>;
export type ListNamespacesResponse = z.infer<
  typeof ListNamespacesResponseSchema
>;
export type GetNamespaceResponse = z.infer<typeof GetNamespaceResponseSchema>;
export type GetNamespaceToolsRequest = z.infer<
  typeof GetNamespaceToolsRequestSchema
>;
export type GetNamespaceToolsResponse = z.infer<
  typeof GetNamespaceToolsResponseSchema
>;
export type UpdateNamespaceRequest = z.infer<
  typeof UpdateNamespaceRequestSchema
>;
export type UpdateNamespaceResponse = z.infer<
  typeof UpdateNamespaceResponseSchema
>;
export type DeleteNamespaceRequest = z.infer<
  typeof DeleteNamespaceRequestSchema
>;
export type DeleteNamespaceResponse = z.infer<
  typeof DeleteNamespaceResponseSchema
>;
export type UpdateNamespaceServerStatusRequest = z.infer<
  typeof UpdateNamespaceServerStatusRequestSchema
>;
export type UpdateNamespaceServerStatusResponse = z.infer<
  typeof UpdateNamespaceServerStatusResponseSchema
>;
export type UpdateNamespaceToolStatusRequest = z.infer<
  typeof UpdateNamespaceToolStatusRequestSchema
>;
export type UpdateNamespaceToolStatusResponse = z.infer<
  typeof UpdateNamespaceToolStatusResponseSchema
>;

// Repository-specific schemas
export const NamespaceCreateInputSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  mcpServerUuids: z.array(z.string()).optional(),
  user_id: z.string().nullable().optional(),
});

export const NamespaceUpdateInputSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  mcpServerUuids: z.array(z.string()).optional(),
  user_id: z.string().nullable().optional(),
});

export const NamespaceServerStatusUpdateSchema = z.object({
  namespaceUuid: z.string(),
  serverUuid: z.string(),
  status: McpServerStatusEnum,
});

export const NamespaceToolStatusUpdateSchema = z.object({
  namespaceUuid: z.string(),
  toolUuid: z.string(),
  serverUuid: z.string(),
  status: ToolStatusEnum,
});

export type NamespaceCreateInput = z.infer<typeof NamespaceCreateInputSchema>;
export type NamespaceUpdateInput = z.infer<typeof NamespaceUpdateInputSchema>;
export type NamespaceServerStatusUpdate = z.infer<
  typeof NamespaceServerStatusUpdateSchema
>;
export type NamespaceToolStatusUpdate = z.infer<
  typeof NamespaceToolStatusUpdateSchema
>;

// Database-specific schemas (raw database results with Date objects)
export const DatabaseNamespaceSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
  user_id: z.string().nullable(),
});

export const DatabaseNamespaceServerSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.enum(["STDIO", "SSE", "STREAMABLE_HTTP"]),
  command: z.string().nullable(),
  args: z.array(z.string()),
  url: z.string().nullable(),
  env: z.record(z.string()),
  bearerToken: z.string().nullable(),
  created_at: z.date(),
  user_id: z.string().nullable(),
  status: McpServerStatusEnum,
});

export const DatabaseNamespaceWithServersSchema =
  DatabaseNamespaceSchema.extend({
    servers: z.array(DatabaseNamespaceServerSchema),
  });

export const DatabaseNamespaceToolSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  toolSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.any()).optional(),
  }),
  created_at: z.date(),
  updated_at: z.date(),
  mcp_server_uuid: z.string(),
  status: ToolStatusEnum,
  serverName: z.string(),
  serverUuid: z.string(),
});

export type DatabaseNamespace = z.infer<typeof DatabaseNamespaceSchema>;
export type DatabaseNamespaceWithServers = z.infer<
  typeof DatabaseNamespaceWithServersSchema
>;
export type DatabaseNamespaceTool = z.infer<typeof DatabaseNamespaceToolSchema>;
