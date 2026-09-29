import { z } from "zod";

// ---------------------------------------------------------------------------
// Roles, capabilities and share levels
// ---------------------------------------------------------------------------

/**
 * Platform-wide roles. A user's effective role is the highest of their base
 * role and the roles granted by the groups they belong to.
 */
export const RoleEnum = z.enum(["admin", "editor", "viewer"]);
export type Role = z.infer<typeof RoleEnum>;

/** Roles ordered from least to most privileged. */
export const ROLE_ORDER: readonly Role[] = ["viewer", "editor", "admin"];

/**
 * Capabilities that can be toggled per role in the permission matrix.
 * Admins implicitly hold every capability (and every administrative right).
 */
export const CapabilityEnum = z.enum([
  // Add remote MCP servers (SSE / Streamable HTTP), incl. from the registry.
  "mcp_servers.create",
  // Add or edit STDIO MCP servers. This runs arbitrary commands on the
  // MetaMCP host, so it is equivalent to shell access.
  "mcp_servers.create_stdio",
  "namespaces.create",
  "endpoints.create",
  // Personal API keys are needed to connect MCP clients to shared endpoints.
  "api_keys.create",
  // Share owned/managed resources with other users and groups.
  "resources.share",
  "inspector.use",
]);
export type Capability = z.infer<typeof CapabilityEnum>;

export const ConfigurableRoleEnum = z.enum(["editor", "viewer"]);
export type ConfigurableRole = z.infer<typeof ConfigurableRoleEnum>;

export const RolePermissionsSchema = z.object({
  editor: z.array(CapabilityEnum),
  viewer: z.array(CapabilityEnum),
});
export type RolePermissions = z.infer<typeof RolePermissionsSchema>;

export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  editor: [
    "mcp_servers.create",
    "namespaces.create",
    "endpoints.create",
    "api_keys.create",
    "resources.share",
    "inspector.use",
  ],
  viewer: ["api_keys.create", "inspector.use"],
};

/** Permission level granted on a single shared resource (lowest first). */
export const ShareLevelEnum = z.enum(["use", "edit", "manage"]);
export type ShareLevel = z.infer<typeof ShareLevelEnum>;

export const SHARE_LEVEL_ORDER: readonly ShareLevel[] = [
  "use",
  "edit",
  "manage",
];

/** Why the current user has access to a resource. */
export const AccessReasonEnum = z.enum(["admin", "owner", "share"]);
export type AccessReason = z.infer<typeof AccessReasonEnum>;

/** Effective access of the current user on a resource, attached to API responses. */
export const ResourceAccessSchema = z.object({
  level: ShareLevelEnum,
  reason: AccessReasonEnum,
});
export type ResourceAccess = z.infer<typeof ResourceAccessSchema>;

export const ResourceOwnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
export type ResourceOwner = z.infer<typeof ResourceOwnerSchema>;

/** Well-known system groups created by the RBAC migration. */
export const SystemGroupKeyEnum = z.enum(["admins", "everyone"]);
export type SystemGroupKey = z.infer<typeof SystemGroupKeyEnum>;

/** How a user became a member of a group. OIDC memberships are re-synced at every SSO login. */
export const MembershipSourceEnum = z.enum(["manual", "oidc"]);
export type MembershipSource = z.infer<typeof MembershipSourceEnum>;

/**
 * Server-side principal resolved for each authenticated request (web session,
 * API key or OAuth token). Not sent over the wire as-is.
 */
export type AccessPrincipal = {
  userId: string;
  baseRole: Role;
  role: Role;
  isAdmin: boolean;
  capabilities: Capability[];
  groupUuids: string[];
};

// ---------------------------------------------------------------------------
// Current user ("me")
// ---------------------------------------------------------------------------

export const AccessGroupSummarySchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
  role: RoleEnum.nullable(),
  systemKey: SystemGroupKeyEnum.nullable(),
  source: MembershipSourceEnum,
});
export type AccessGroupSummary = z.infer<typeof AccessGroupSummarySchema>;

export const AccessMeSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  baseRole: RoleEnum,
  role: RoleEnum,
  isAdmin: z.boolean(),
  capabilities: z.array(CapabilityEnum),
  groups: z.array(AccessGroupSummarySchema),
});
export type AccessMe = z.infer<typeof AccessMeSchema>;

// ---------------------------------------------------------------------------
// Admin: users
// ---------------------------------------------------------------------------

export const UserStatusEnum = z.enum(["active", "disabled"]);
export type UserStatus = z.infer<typeof UserStatusEnum>;

export const AdminUserGroupSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
  role: RoleEnum.nullable(),
  systemKey: SystemGroupKeyEnum.nullable(),
  source: MembershipSourceEnum,
});

export const AdminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  baseRole: RoleEnum,
  role: RoleEnum,
  disabled: z.boolean(),
  disabledAt: z.date().nullable(),
  groups: z.array(AdminUserGroupSchema),
  authMethods: z.array(z.string()),
  externalGroups: z.array(z.string()),
  externalGroupsSyncedAt: z.date().nullable(),
  createdAt: z.date(),
  lastSeenAt: z.date().nullable(),
  resourceCounts: z.object({
    mcpServers: z.number(),
    namespaces: z.number(),
    endpoints: z.number(),
    apiKeys: z.number(),
  }),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const ListUsersRequestSchema = z.object({
  search: z.string().max(200).optional(),
  role: RoleEnum.optional(),
  status: UserStatusEnum.optional(),
  groupUuid: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type ListUsersRequest = z.infer<typeof ListUsersRequestSchema>;

export const ListUsersResponseSchema = z.object({
  users: z.array(AdminUserSchema),
  total: z.number(),
});
export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>;

export const CreateUserRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
  baseRole: RoleEnum,
  groupUuids: z.array(z.string().uuid()).default([]),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  baseRole: RoleEnum.optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const SetUserPasswordRequestSchema = z.object({
  id: z.string().min(1),
  password: z.string().min(8).max(128),
});
export type SetUserPasswordRequest = z.infer<
  typeof SetUserPasswordRequestSchema
>;

export const SetUserDisabledRequestSchema = z.object({
  id: z.string().min(1),
  disabled: z.boolean(),
});
export type SetUserDisabledRequest = z.infer<
  typeof SetUserDisabledRequestSchema
>;

/**
 * What happens to the resources (MCP servers, namespaces, endpoints) owned by
 * a deleted user. API keys and sessions are always revoked.
 */
export const UserResourceTransferSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("delete") }),
  z.object({ mode: z.literal("organization") }),
  z.object({ mode: z.literal("user"), userId: z.string().min(1) }),
]);
export type UserResourceTransfer = z.infer<typeof UserResourceTransferSchema>;

export const DeleteUserRequestSchema = z.object({
  id: z.string().min(1),
  transfer: UserResourceTransferSchema,
});
export type DeleteUserRequest = z.infer<typeof DeleteUserRequestSchema>;

export const UserIdRequestSchema = z.object({ id: z.string().min(1) });
export type UserIdRequest = z.infer<typeof UserIdRequestSchema>;

export const AdminMutationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type AdminMutationResponse = z.infer<typeof AdminMutationResponseSchema>;

// ---------------------------------------------------------------------------
// Admin: groups
// ---------------------------------------------------------------------------

const GroupNameSchema = z
  .string()
  .trim()
  .min(1, "Group name is required")
  .max(64, "Group name must be at most 64 characters");

/**
 * An IdP group value mapped to a MetaMCP group. Matching is case-insensitive;
 * `*` is a wildcard (e.g. `/engineering/*`).
 */
const OidcGroupPatternSchema = z.string().trim().min(1).max(256);

export const GroupSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  role: RoleEnum.nullable(),
  systemKey: SystemGroupKeyEnum.nullable(),
  oidcGroups: z.array(z.string()),
  memberCount: z.number(),
  shareCount: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Group = z.infer<typeof GroupSchema>;

export const GroupMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  role: RoleEnum,
  disabled: z.boolean(),
  source: MembershipSourceEnum,
  addedAt: z.date(),
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;

export const GroupShareSchema = z.object({
  shareUuid: z.string().uuid(),
  resourceType: z.enum(["mcp_server", "namespace"]),
  resourceUuid: z.string().uuid(),
  resourceName: z.string(),
  level: ShareLevelEnum,
});
export type GroupShare = z.infer<typeof GroupShareSchema>;

export const GroupDetailSchema = GroupSchema.extend({
  members: z.array(GroupMemberSchema),
  shares: z.array(GroupShareSchema),
});
export type GroupDetail = z.infer<typeof GroupDetailSchema>;

export const CreateGroupRequestSchema = z.object({
  name: GroupNameSchema,
  description: z.string().trim().max(500).nullable().optional(),
  role: RoleEnum.nullable().default(null),
  oidcGroups: z.array(OidcGroupPatternSchema).max(100).default([]),
  memberIds: z.array(z.string().min(1)).default([]),
});
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;

export const UpdateGroupRequestSchema = z.object({
  uuid: z.string().uuid(),
  name: GroupNameSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  role: RoleEnum.nullable().optional(),
  oidcGroups: z.array(OidcGroupPatternSchema).max(100).optional(),
});
export type UpdateGroupRequest = z.infer<typeof UpdateGroupRequestSchema>;

export const GroupUuidRequestSchema = z.object({ uuid: z.string().uuid() });
export type GroupUuidRequest = z.infer<typeof GroupUuidRequestSchema>;

export const AddGroupMembersRequestSchema = z.object({
  groupUuid: z.string().uuid(),
  userIds: z.array(z.string().min(1)).min(1).max(500),
});
export type AddGroupMembersRequest = z.infer<
  typeof AddGroupMembersRequestSchema
>;

export const RemoveGroupMemberRequestSchema = z.object({
  groupUuid: z.string().uuid(),
  userId: z.string().min(1),
});
export type RemoveGroupMemberRequest = z.infer<
  typeof RemoveGroupMemberRequestSchema
>;

// ---------------------------------------------------------------------------
// Admin: SSO (OIDC) group synchronisation
// ---------------------------------------------------------------------------

export const SsoSettingsSchema = z.object({
  /** Read-only: whether an OIDC provider is configured through env vars. */
  oidcConfigured: z.boolean(),
  /** Read-only: the configured provider id (OIDC_PROVIDER_ID). */
  providerId: z.string().nullable(),
  /** Name of the ID token / userinfo claim holding the user's groups. */
  groupsClaim: z.string().trim().min(1).max(128),
  /** Re-sync OIDC-sourced group memberships at every SSO login. */
  syncGroups: z.boolean(),
  /** Refuse SSO logins whose groups match no MetaMCP group mapping. */
  requireGroupMatch: z.boolean(),
  /** Base role given to newly created users (all sign-up methods). */
  defaultRole: RoleEnum,
});
export type SsoSettings = z.infer<typeof SsoSettingsSchema>;

export const UpdateSsoSettingsRequestSchema = SsoSettingsSchema.pick({
  groupsClaim: true,
  syncGroups: true,
  requireGroupMatch: true,
  defaultRole: true,
}).partial();
export type UpdateSsoSettingsRequest = z.infer<
  typeof UpdateSsoSettingsRequestSchema
>;

export const TestSsoMappingRequestSchema = z.object({
  groups: z.array(z.string().trim().min(1).max(256)).max(500),
});
export type TestSsoMappingRequest = z.infer<typeof TestSsoMappingRequestSchema>;

export const TestSsoMappingResponseSchema = z.object({
  matches: z.array(
    z.object({
      groupUuid: z.string().uuid(),
      groupName: z.string(),
      role: RoleEnum.nullable(),
      matchedBy: z.array(z.string()),
    }),
  ),
  resultingRole: RoleEnum,
  denied: z.boolean(),
});
export type TestSsoMappingResponse = z.infer<
  typeof TestSsoMappingResponseSchema
>;

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export const ShareResourceTypeEnum = z.enum(["mcp_server", "namespace"]);
export type ShareResourceType = z.infer<typeof ShareResourceTypeEnum>;

export const ShareSubjectTypeEnum = z.enum(["user", "group"]);
export type ShareSubjectType = z.infer<typeof ShareSubjectTypeEnum>;

export const ShareSubjectSchema = z.object({
  type: ShareSubjectTypeEnum,
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  image: z.string().nullable(),
  systemKey: SystemGroupKeyEnum.nullable(),
  memberCount: z.number().nullable(),
});
export type ShareSubject = z.infer<typeof ShareSubjectSchema>;

export const ShareSchema = z.object({
  uuid: z.string().uuid(),
  subject: ShareSubjectSchema,
  level: ShareLevelEnum,
  createdAt: z.date(),
});
export type Share = z.infer<typeof ShareSchema>;

export const ResourceRefSchema = z.object({
  resourceType: ShareResourceTypeEnum,
  resourceUuid: z.string().uuid(),
});
export type ResourceRef = z.infer<typeof ResourceRefSchema>;

export const ListSharesResponseSchema = z.object({
  resourceName: z.string(),
  owner: ResourceOwnerSchema.nullable(),
  access: ResourceAccessSchema,
  canManage: z.boolean(),
  shares: z.array(ShareSchema),
});
export type ListSharesResponse = z.infer<typeof ListSharesResponseSchema>;

export const UpsertShareRequestSchema = ResourceRefSchema.extend({
  subjectType: ShareSubjectTypeEnum,
  subjectId: z.string().min(1),
  level: ShareLevelEnum,
});
export type UpsertShareRequest = z.infer<typeof UpsertShareRequestSchema>;

export const RemoveShareRequestSchema = z.object({
  shareUuid: z.string().uuid(),
});
export type RemoveShareRequest = z.infer<typeof RemoveShareRequestSchema>;

export const SearchShareSubjectsRequestSchema = z.object({
  query: z.string().trim().max(200).default(""),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchShareSubjectsRequest = z.infer<
  typeof SearchShareSubjectsRequestSchema
>;

export const SearchShareSubjectsResponseSchema = z.object({
  subjects: z.array(ShareSubjectSchema),
});
export type SearchShareSubjectsResponse = z.infer<
  typeof SearchShareSubjectsResponseSchema
>;

export const ShareMutationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type ShareMutationResponse = z.infer<typeof ShareMutationResponseSchema>;

// ---------------------------------------------------------------------------
// Helpers shared by backend and frontend
// ---------------------------------------------------------------------------

export function roleRank(role: Role): number {
  return ROLE_ORDER.indexOf(role);
}

export function maxRole(roles: readonly Role[], fallback: Role): Role {
  return roles.reduce(
    (best, role) => (roleRank(role) > roleRank(best) ? role : best),
    fallback,
  );
}

export function shareLevelRank(level: ShareLevel): number {
  return SHARE_LEVEL_ORDER.indexOf(level);
}

export function isShareLevelAtLeast(
  level: ShareLevel | null | undefined,
  required: ShareLevel,
): boolean {
  if (!level) return false;
  return shareLevelRank(level) >= shareLevelRank(required);
}

export function maxShareLevel(
  levels: readonly (ShareLevel | null | undefined)[],
): ShareLevel | null {
  let best: ShareLevel | null = null;
  for (const level of levels) {
    if (
      level &&
      (best === null || shareLevelRank(level) > shareLevelRank(best))
    ) {
      best = level;
    }
  }
  return best;
}
