import { z } from "zod";

// Administrative activity log: who changed access, configuration or
// resources, and security events (sign-ins, denials, key rotations).
// Append-only; readable by administrators only.

export const ActivityCategoryEnum = z.enum([
  "auth",
  "users",
  "groups",
  "roles",
  "sso",
  "settings",
  "sharing",
  "resources",
  "api_keys",
  "security",
]);
export type ActivityCategory = z.infer<typeof ActivityCategoryEnum>;

export const ACTIVITY_ACTIONS = {
  // Sign-in
  "auth.sign_in": "auth",
  "auth.sign_in_denied": "auth",
  // MetaMCP OAuth server: a user approved / refused a client
  "oauth.client_authorized": "auth",
  "oauth.client_denied": "auth",
  // Users
  "user.created": "users",
  "user.provisioned": "users",
  "user.updated": "users",
  "user.promoted": "users",
  "user.password_reset": "users",
  "user.disabled": "users",
  "user.enabled": "users",
  "user.sessions_revoked": "users",
  "user.deleted": "users",
  // Groups
  "group.created": "groups",
  "group.updated": "groups",
  "group.deleted": "groups",
  "group.members_added": "groups",
  "group.member_removed": "groups",
  "group.memberships_synced": "groups",
  // Roles, single sign-on, settings
  "roles.permissions_updated": "roles",
  "sso.settings_updated": "sso",
  "settings.updated": "settings",
  // Sharing
  "share.granted": "sharing",
  "share.revoked": "sharing",
  // Resources
  "mcp_server.created": "resources",
  "mcp_server.updated": "resources",
  "mcp_server.deleted": "resources",
  "namespace.created": "resources",
  "namespace.updated": "resources",
  "namespace.deleted": "resources",
  "endpoint.created": "resources",
  "endpoint.updated": "resources",
  "endpoint.deleted": "resources",
  // API keys
  "api_key.created": "api_keys",
  "api_key.updated": "api_keys",
  "api_key.deleted": "api_keys",
  // Security
  "secrets.data_key_rotated": "security",
  "secrets.data_key_rewrapped": "security",
} as const satisfies Record<string, ActivityCategory>;

export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;
export const ActivityActionEnum = z.enum(
  Object.keys(ACTIVITY_ACTIONS) as [ActivityAction, ...ActivityAction[]],
);

export const ActivityActorTypeEnum = z.enum(["user", "api_key", "system"]);
export type ActivityActorType = z.infer<typeof ActivityActorTypeEnum>;

export const ActivityOutcomeEnum = z.enum(["success", "denied", "failure"]);
export type ActivityOutcome = z.infer<typeof ActivityOutcomeEnum>;

export const ActivityLogEntrySchema = z.object({
  uuid: z.string().uuid(),
  createdAt: z.date(),
  actorType: ActivityActorTypeEnum,
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  category: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  targetLabel: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  outcome: ActivityOutcomeEnum,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;

export const ListActivityRequestSchema = z.object({
  search: z.string().trim().max(200).optional(),
  category: ActivityCategoryEnum.optional(),
  outcome: ActivityOutcomeEnum.optional(),
  actorId: z.string().optional(),
  targetId: z.string().optional(),
  // Dates arrive as ISO strings over tRPC.
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});
export type ListActivityRequest = z.infer<typeof ListActivityRequestSchema>;

export const ListActivityResponseSchema = z.object({
  entries: z.array(ActivityLogEntrySchema),
  total: z.number(),
  retentionDays: z.number().nullable(),
});
export type ListActivityResponse = z.infer<typeof ListActivityResponseSchema>;

export const ExportActivityResponseSchema = z.object({
  csv: z.string(),
  truncated: z.boolean(),
});
export type ExportActivityResponse = z.infer<
  typeof ExportActivityResponseSchema
>;
