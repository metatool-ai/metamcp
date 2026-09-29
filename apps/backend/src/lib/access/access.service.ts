import type {
  AccessMe,
  AccessPrincipal,
  ResourceAccess,
  Role,
  ShareResourceType,
} from "@repo/zod-types";

import type { AccessibleFilter } from "../../db/repositories/access-filter";
import { groupsRepository } from "../../db/repositories/groups.repo";
import { resourceSharesRepository } from "../../db/repositories/resource-shares.repo";
import { usersRepository } from "../../db/repositories/users.repo";
import { accessSettings } from "./access-settings";
import { endpointAccessCache } from "./endpoint-access-cache";
import { buildPrincipal, resolveResourceAccess } from "./policy";

/**
 * Resolves who a user is for authorization purposes and what they can reach.
 *
 * Principals are cached for a few seconds: they are needed on every tRPC call
 * and on every MCP request through a public endpoint. Every mutation that can
 * change a principal (role, membership, group role, disable) calls
 * `invalidateUser` / `invalidateAll`.
 */

const PRINCIPAL_TTL_MS = 5_000;
const EVERYONE_TTL_MS = 30_000;

type OwnedResource = { uuid: string; user_id: string | null };

class AccessService {
  private principals = new Map<
    string,
    { value: AccessPrincipal | null; expiresAt: number }
  >();
  private everyone: {
    value: { uuid: string; role: Role | null } | null;
    expiresAt: number;
  } | null = null;

  invalidateUser(userId: string): void {
    this.principals.delete(userId);
    endpointAccessCache.clear();
  }

  invalidateAll(): void {
    this.principals.clear();
    this.everyone = null;
    endpointAccessCache.clear();
  }

  /** The implicit "Everyone" group (every user is a member). */
  async getEveryoneGroup(): Promise<{
    uuid: string;
    role: Role | null;
  } | null> {
    if (this.everyone && this.everyone.expiresAt > Date.now()) {
      return this.everyone.value;
    }
    const group = await groupsRepository.findBySystemKey("everyone");
    const value = group ? { uuid: group.uuid, role: group.role } : null;
    this.everyone = { value, expiresAt: Date.now() + EVERYONE_TTL_MS };
    return value;
  }

  /**
   * Returns the principal of an active user, or null when the user does not
   * exist or is disabled (callers must then treat the request as anonymous).
   */
  async getPrincipal(userId: string): Promise<AccessPrincipal | null> {
    const cached = this.principals.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const user = await usersRepository.findById(userId);
    let value: AccessPrincipal | null = null;
    if (user && !user.disabled) {
      const [memberships, everyone, rolePermissions] = await Promise.all([
        groupsRepository.getMembershipsForUser(userId),
        this.getEveryoneGroup(),
        accessSettings.getRolePermissions(),
      ]);
      const groups = memberships.map((membership) => ({
        uuid: membership.groupUuid,
        role: membership.role,
      }));
      if (everyone && !groups.some((group) => group.uuid === everyone.uuid)) {
        groups.push({ uuid: everyone.uuid, role: everyone.role });
      }
      value = buildPrincipal({
        userId,
        baseRole: user.role,
        groups,
        rolePermissions,
      });
    }

    this.principals.set(userId, {
      value,
      expiresAt: Date.now() + PRINCIPAL_TTL_MS,
    });
    return value;
  }

  async getMe(userId: string): Promise<AccessMe | null> {
    const [user, principal, memberships] = await Promise.all([
      usersRepository.findById(userId),
      this.getPrincipal(userId),
      groupsRepository.getMembershipsForUser(userId),
    ]);
    if (!user || !principal) return null;
    return {
      userId,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      baseRole: principal.baseRole,
      role: principal.role,
      isAdmin: principal.isAdmin,
      capabilities: principal.capabilities,
      groups: memberships.map((membership) => ({
        uuid: membership.groupUuid,
        name: membership.name,
        role: membership.role,
        systemKey: membership.systemKey,
        source: membership.source,
      })),
    };
  }

  /** Access of `principal` on each resource (null = no access). */
  async resolveAccess(
    principal: AccessPrincipal,
    type: ShareResourceType,
    resources: readonly OwnedResource[],
  ): Promise<Map<string, ResourceAccess | null>> {
    const result = new Map<string, ResourceAccess | null>();
    if (resources.length === 0) return result;

    const needShares = resources
      .filter(
        (resource) =>
          !principal.isAdmin && resource.user_id !== principal.userId,
      )
      .map((resource) => resource.uuid);

    const [grants, everyone] = await Promise.all([
      resourceSharesRepository.findGrantsForResources(type, needShares),
      this.getEveryoneGroup(),
    ]);
    const grantsByResource = new Map<string, typeof grants>();
    for (const grant of grants) {
      const list = grantsByResource.get(grant.resourceUuid) ?? [];
      list.push(grant);
      grantsByResource.set(grant.resourceUuid, list);
    }

    for (const resource of resources) {
      result.set(
        resource.uuid,
        resolveResourceAccess({
          principal,
          ownerId: resource.user_id,
          shares: grantsByResource.get(resource.uuid) ?? [],
          everyoneGroupUuid: everyone?.uuid ?? null,
        }),
      );
    }
    return result;
  }

  async resolveAccessOne(
    principal: AccessPrincipal,
    type: ShareResourceType,
    resource: OwnedResource,
  ): Promise<ResourceAccess | null> {
    const map = await this.resolveAccess(principal, type, [resource]);
    return map.get(resource.uuid) ?? null;
  }

  /**
   * Access granted to anyone in the organisation (shares to "Everyone").
   * Used for organisation API keys, which are not tied to a user.
   */
  async resolveEveryoneAccess(
    type: ShareResourceType,
    resourceUuid: string,
  ): Promise<ResourceAccess | null> {
    const everyone = await this.getEveryoneGroup();
    if (!everyone) return null;
    const grants = await resourceSharesRepository.findGrantsForResources(type, [
      resourceUuid,
    ]);
    const grant = grants.find((row) => row.groupUuid === everyone.uuid);
    return grant ? { level: grant.level, reason: "share" } : null;
  }

  /** SQL-friendly description of the resources a principal can see. */
  async accessibleFilter(
    principal: AccessPrincipal,
    type: ShareResourceType,
  ): Promise<AccessibleFilter> {
    if (principal.isAdmin) return { all: true };
    const sharedUuids = await resourceSharesRepository.findSharedResourceUuids(
      type,
      principal.userId,
      principal.groupUuids,
    );
    return { all: false, ownerId: principal.userId, sharedUuids };
  }
}

export const accessService = new AccessService();
