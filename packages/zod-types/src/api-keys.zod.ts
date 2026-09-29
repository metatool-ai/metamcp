import { z } from "zod";

// Base API Key schemas. MetaMCP only stores a digest of each key: the key
// itself is returned once, at creation; afterwards only a preview
// (`sk_mt_AbCd…wxyz`) is available.

/**
 * What a key may be used for:
 * - "user": everything its owner can do (every endpoint they can reach, the
 *   MetaMCP admin tools where enabled);
 * - "endpoints": only the MCP traffic (MCP, SSE, REST tool calls) of the
 *   listed endpoints, which the owner must still be able to reach. Never the
 *   admin tools nor the endpoint administration routes.
 */
export const ApiKeyScopeEnum = z.enum(["user", "endpoints"]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeEnum>;

/** At most this many endpoints per endpoint-scoped key. */
export const MAX_API_KEY_ENDPOINTS = 100;

const ApiKeyEndpointUuidsSchema = z
  .array(z.string().uuid())
  .max(MAX_API_KEY_ENDPOINTS);

export const ApiKeyEndpointRefSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
});

/** Scope settings, shared by creation and update. */
function refineScope(
  value: { scope?: ApiKeyScope; endpoint_uuids?: string[] },
  ctx: z.RefinementCtx,
) {
  if (value.scope === "endpoints" && !value.endpoint_uuids?.length) {
    ctx.addIssue({
      code: "custom",
      path: ["endpoint_uuids"],
      message: "validation:apiKeyScope.endpointsRequired",
    });
  }
}

export const ApiKeySchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
  key_preview: z.string(),
  user_id: z.string().nullable(),
  created_at: z.date(),
  is_active: z.boolean(),
});

export const CreateApiKeyFormSchema = z
  .object({
    name: z
      .string()
      .min(1, "validation:apiKeyName.required")
      .max(100, "Name must be less than 100 characters")
      .regex(
        /^[a-zA-Z0-9_\s-]+$/,
        "Name can only contain letters, numbers, spaces, underscores, and hyphens",
      ),
    user_id: z.string().nullable().optional(),
    scope: ApiKeyScopeEnum,
    endpoint_uuids: ApiKeyEndpointUuidsSchema,
  })
  .superRefine(refineScope);

export const CreateApiKeyRequestSchema = z
  .object({
    name: z
      .string()
      .min(1, "validation:apiKeyName.required")
      .max(100, "Name must be less than 100 characters")
      .regex(
        /^[a-zA-Z0-9_\s-]+$/,
        "Name can only contain letters, numbers, spaces, underscores, and hyphens",
      ),
    user_id: z.string().nullable().optional(),
    scope: ApiKeyScopeEnum.default("user"),
    endpoint_uuids: ApiKeyEndpointUuidsSchema.optional(),
  })
  .superRefine(refineScope);

export const CreateApiKeyResponseSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
  // The full key, shown once: it cannot be retrieved later.
  key: z.string(),
  key_preview: z.string(),
  created_at: z.date(),
});

export const UpdateApiKeyRequestSchema = z
  .object({
    uuid: z.string().uuid(),
    name: z
      .string()
      .min(1, "validation:apiKeyName.required")
      .max(100, "Name must be less than 100 characters")
      .regex(
        /^[a-zA-Z0-9_\s-]+$/,
        "Name can only contain letters, numbers, spaces, underscores, and hyphens",
      )
      .optional(),
    is_active: z.boolean().optional(),
    // Both given together to change what the key is limited to
    scope: ApiKeyScopeEnum.optional(),
    endpoint_uuids: ApiKeyEndpointUuidsSchema.optional(),
  })
  .superRefine(refineScope);

export const UpdateApiKeyResponseSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
  key_preview: z.string(),
  created_at: z.date(),
  is_active: z.boolean(),
  scope: ApiKeyScopeEnum,
});

export const DeleteApiKeyRequestSchema = z.object({
  uuid: z.string().uuid(),
});

export const DeleteApiKeyResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const ListApiKeysRequestSchema = z
  .object({
    // Administrators only: the keys of every user (to revoke a leaked one)
    allUsers: z.boolean().optional(),
  })
  .optional();

export const ApiKeyOwnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export const ApiKeyListItemSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
  key_preview: z.string(),
  created_at: z.date(),
  is_active: z.boolean(),
  user_id: z.string().nullable(),
  scope: ApiKeyScopeEnum,
  endpoints: z.array(ApiKeyEndpointRefSchema),
  owner: ApiKeyOwnerSchema.nullable(),
});
export type ApiKeyListItem = z.infer<typeof ApiKeyListItemSchema>;

export const ListApiKeysResponseSchema = z.object({
  apiKeys: z.array(ApiKeyListItemSchema),
});

export const ValidateApiKeyRequestSchema = z.object({
  key: z.string(),
});

export const ValidateApiKeyResponseSchema = z.object({
  valid: z.boolean(),
  user_id: z.string().optional(),
  key_uuid: z.string().uuid().optional(),
  scope: ApiKeyScopeEnum.optional(),
  endpoint_uuids: z.array(z.string().uuid()).optional(),
});

// Repository schemas
export const ApiKeyCreateInputSchema = z.object({
  name: z.string(),
  user_id: z.string().nullable().optional(),
  is_active: z.boolean().optional().default(true),
  scope: ApiKeyScopeEnum.optional().default("user"),
  endpoint_uuids: z.array(z.string().uuid()).optional(),
});

export const ApiKeyUpdateInputSchema = z.object({
  name: z.string().optional(),
  is_active: z.boolean().optional(),
  scope: ApiKeyScopeEnum.optional(),
  endpoint_uuids: z.array(z.string().uuid()).optional(),
});

// Type exports
export type ApiKey = z.infer<typeof ApiKeySchema>;
export type CreateApiKeyForm = z.infer<typeof CreateApiKeyFormSchema>;
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponseSchema>;
export type UpdateApiKeyRequest = z.infer<typeof UpdateApiKeyRequestSchema>;
export type UpdateApiKeyResponse = z.infer<typeof UpdateApiKeyResponseSchema>;
export type DeleteApiKeyRequest = z.infer<typeof DeleteApiKeyRequestSchema>;
export type DeleteApiKeyResponse = z.infer<typeof DeleteApiKeyResponseSchema>;
export type ListApiKeysRequest = z.infer<typeof ListApiKeysRequestSchema>;
export type ListApiKeysResponse = z.infer<typeof ListApiKeysResponseSchema>;
export type ValidateApiKeyRequest = z.infer<typeof ValidateApiKeyRequestSchema>;
export type ValidateApiKeyResponse = z.infer<
  typeof ValidateApiKeyResponseSchema
>;
export type ApiKeyCreateInput = z.infer<typeof ApiKeyCreateInputSchema>;
export type ApiKeyUpdateInput = z.infer<typeof ApiKeyUpdateInputSchema>;
