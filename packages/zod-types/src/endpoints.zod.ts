import { z } from "zod";

import { DatabaseNamespaceSchema, NamespaceSchema } from "./namespaces.zod";

// Endpoint schema definitions
export const createEndpointFormSchema = z.object({
  name: z
    .string()
    .min(1, "validation:endpointName.required")
    .regex(/^[a-zA-Z0-9_-]+$/, "validation:endpointName.urlCompatible"),
  description: z.string().optional(),
  namespaceUuid: z.string().uuid("Please select a valid namespace"),
  enableApiKeyAuth: z.boolean(),
  enableOauth: z.boolean(),
  useQueryParamAuth: z.boolean(),
  createMcpServer: z.boolean(),
  user_id: z.string().nullable().optional(),
});

export const editEndpointFormSchema = z.object({
  name: z
    .string()
    .min(1, "validation:endpointName.required")
    .regex(/^[a-zA-Z0-9_-]+$/, "validation:endpointName.urlCompatible"),
  description: z.string().optional(),
  namespaceUuid: z.string().uuid("Please select a valid namespace"),
  enableApiKeyAuth: z.boolean().optional(),
  enableOauth: z.boolean().optional(),
  useQueryParamAuth: z.boolean().optional(),
  user_id: z.string().nullable().optional(),
});

export const CreateEndpointRequestSchema = z.object({
  name: z
    .string()
    .min(1, "validation:endpointName.required")
    .regex(/^[a-zA-Z0-9_-]+$/, "validation:endpointName.urlCompatible"),
  description: z.string().optional(),
  namespaceUuid: z.string().uuid(),
  enableApiKeyAuth: z.boolean().default(true),
  enableOauth: z.boolean().default(false),
  useQueryParamAuth: z.boolean().default(false),
  createMcpServer: z.boolean().default(true),
  user_id: z.string().nullable().optional(),
});

export const EndpointSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  namespace_uuid: z.string(),
  enable_api_key_auth: z.boolean(),
  enable_oauth: z.boolean(),
  use_query_param_auth: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  user_id: z.string().nullable(),
});

// Extended endpoint schema with namespace details
export const EndpointWithNamespaceSchema = EndpointSchema.extend({
  namespace: NamespaceSchema,
});

export const CreateEndpointResponseSchema = z.object({
  success: z.boolean(),
  data: EndpointSchema.optional(),
  message: z.string().optional(),
});

export const ListEndpointsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(EndpointWithNamespaceSchema),
  message: z.string().optional(),
});

export const GetEndpointResponseSchema = z.object({
  success: z.boolean(),
  data: EndpointWithNamespaceSchema.optional(),
  message: z.string().optional(),
});

export const UpdateEndpointRequestSchema = z.object({
  uuid: z.string(),
  name: z
    .string()
    .min(1, "validation:endpointName.required")
    .regex(/^[a-zA-Z0-9_-]+$/, "validation:endpointName.urlCompatible"),
  description: z.string().optional(),
  namespaceUuid: z.string().uuid(),
  enableApiKeyAuth: z.boolean().optional(),
  enableOauth: z.boolean().optional(),
  useQueryParamAuth: z.boolean().optional(),
  user_id: z.string().nullable().optional(),
});

export const UpdateEndpointResponseSchema = z.object({
  success: z.boolean(),
  data: EndpointSchema.optional(),
  message: z.string().optional(),
});

export const DeleteEndpointRequestSchema = z.object({
  uuid: z.string(),
});

export const DeleteEndpointResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

// Type exports
export type CreateEndpointFormData = z.infer<typeof createEndpointFormSchema>;
export type EditEndpointFormData = z.infer<typeof editEndpointFormSchema>;
export type CreateEndpointRequest = z.infer<typeof CreateEndpointRequestSchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type EndpointWithNamespace = z.infer<typeof EndpointWithNamespaceSchema>;
export type CreateEndpointResponse = z.infer<
  typeof CreateEndpointResponseSchema
>;
export type ListEndpointsResponse = z.infer<typeof ListEndpointsResponseSchema>;
export type GetEndpointResponse = z.infer<typeof GetEndpointResponseSchema>;
export type UpdateEndpointRequest = z.infer<typeof UpdateEndpointRequestSchema>;
export type UpdateEndpointResponse = z.infer<
  typeof UpdateEndpointResponseSchema
>;
export type DeleteEndpointRequest = z.infer<typeof DeleteEndpointRequestSchema>;
export type DeleteEndpointResponse = z.infer<
  typeof DeleteEndpointResponseSchema
>;

// Repository-specific schemas
export const EndpointCreateInputSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  namespace_uuid: z.string(),
  enable_api_key_auth: z.boolean().optional().default(true),
  enable_oauth: z.boolean().optional().default(false),
  use_query_param_auth: z.boolean().optional().default(false),
  user_id: z.string().nullable().optional(),
});

export const EndpointUpdateInputSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  namespace_uuid: z.string(),
  enable_api_key_auth: z.boolean().optional(),
  enable_oauth: z.boolean().optional(),
  use_query_param_auth: z.boolean().optional(),
  user_id: z.string().nullable().optional(),
});

export type EndpointCreateInput = z.infer<typeof EndpointCreateInputSchema>;
export type EndpointUpdateInput = z.infer<typeof EndpointUpdateInputSchema>;

// Database-specific schemas (raw database results with Date objects)
export const DatabaseEndpointSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  namespace_uuid: z.string(),
  enable_api_key_auth: z.boolean(),
  enable_oauth: z.boolean(),
  use_query_param_auth: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
  user_id: z.string().nullable(),
});

export const DatabaseEndpointWithNamespaceSchema =
  DatabaseEndpointSchema.extend({
    namespace: DatabaseNamespaceSchema,
  });

export type DatabaseEndpoint = z.infer<typeof DatabaseEndpointSchema>;
export type DatabaseEndpointWithNamespace = z.infer<
  typeof DatabaseEndpointWithNamespaceSchema
>;
