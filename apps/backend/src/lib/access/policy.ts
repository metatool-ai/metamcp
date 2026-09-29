import {
  type AccessPrincipal,
  type Capability,
  CapabilityEnum,
  DEFAULT_ROLE_PERMISSIONS,
  isShareLevelAtLeast,
  maxRole,
  maxShareLevel,
  type ResourceAccess,
  type Role,
  type RolePermissions,
  type ShareLevel,
} from "@repo/zod-types";

/**
 * Pure RBAC policy helpers. Everything here is deterministic and free of I/O
 * so it can be unit-tested exhaustively; the DB-backed parts live in
 * access.service.ts.
 */

export const ALL_CAPABILITIES: readonly Capability[] = CapabilityEnum.options;

/** Effective role = highest of the base role and every group-granted role. */
export function resolveEffectiveRole(
  baseRole: Role,
  groupRoles: readonly (Role | null | undefined)[],
): Role {
  const granted = groupRoles.filter((role): role is Role => Boolean(role));
  return maxRole(granted, baseRole);
}

/**
 * Capabilities held by a role. Admins hold every capability regardless of the
 * configured matrix so an administrator can never lock themselves out.
 */
export function resolveCapabilities(
  role: Role,
  rolePermissions: RolePermissions = DEFAULT_ROLE_PERMISSIONS,
): Capability[] {
  if (role === "admin") {
    return [...ALL_CAPABILITIES];
  }
  const configured = rolePermissions[role] ?? DEFAULT_ROLE_PERMISSIONS[role];
  // Keep a stable order and drop unknown values coming from stored config.
  return ALL_CAPABILITIES.filter((capability) =>
    configured.includes(capability),
  );
}

export function buildPrincipal(input: {
  userId: string;
  baseRole: Role;
  groups: readonly { uuid: string; role: Role | null }[];
  rolePermissions?: RolePermissions;
}): AccessPrincipal {
  const role = resolveEffectiveRole(
    input.baseRole,
    input.groups.map((group) => group.role),
  );
  return {
    userId: input.userId,
    baseRole: input.baseRole,
    role,
    isAdmin: role === "admin",
    capabilities: resolveCapabilities(role, input.rolePermissions),
    groupUuids: input.groups.map((group) => group.uuid),
  };
}

export function hasCapability(
  principal: AccessPrincipal,
  capability: Capability,
): boolean {
  return principal.isAdmin || principal.capabilities.includes(capability);
}

/**
 * Live inspection from the web UI (listing and calling tools through the
 * inspector proxy, outside audited endpoints). Anyone who can edit a server
 * or namespace may test it; with "use" access only, the inspector permission
 * is required as well.
 */
export function canInspect(
  principal: AccessPrincipal,
  access: ResourceAccess | null | undefined,
): boolean {
  if (!access) return false;
  return (
    isShareLevelAtLeast(access.level, "edit") ||
    hasCapability(principal, "inspector.use")
  );
}

/** A share row reduced to what the policy needs. */
export type ShareGrant = {
  userId: string | null;
  groupUuid: string | null;
  level: ShareLevel;
};

/**
 * Computes the current user's access to a resource.
 *
 * - the owner (user_id) gets `manage`;
 * - admins get `manage` on organisation resources (no owner), and nothing
 *   more than anyone else on the personal resources of other users;
 * - otherwise the highest level among the shares targeting the user directly,
 *   one of their groups, or the implicit "Everyone" group.
 *
 * `everyoneGroupUuid` is the uuid of the system group every authenticated
 * user implicitly belongs to (it has no stored memberships).
 */
export function resolveResourceAccess(input: {
  principal: AccessPrincipal;
  ownerId: string | null;
  shares: readonly ShareGrant[];
  everyoneGroupUuid: string | null;
}): ResourceAccess | null {
  const { principal, ownerId, shares, everyoneGroupUuid } = input;

  if (ownerId !== null && ownerId === principal.userId) {
    return { level: "manage", reason: "owner" };
  }
  if (ownerId === null && principal.isAdmin) {
    return { level: "manage", reason: "admin" };
  }

  const memberOf = new Set(principal.groupUuids);
  if (everyoneGroupUuid) {
    memberOf.add(everyoneGroupUuid);
  }

  const level = maxShareLevel(
    shares
      .filter(
        (share) =>
          (share.userId !== null && share.userId === principal.userId) ||
          (share.groupUuid !== null && memberOf.has(share.groupUuid)),
      )
      .map((share) => share.level),
  );

  return level ? { level, reason: "share" } : null;
}
