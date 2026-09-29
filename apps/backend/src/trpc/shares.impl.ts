import {
  type AccessPrincipal,
  type ListSharesResponse,
  type RemoveShareRequest,
  type ResourceRef,
  type SearchShareSubjectsRequest,
  type SearchShareSubjectsResponse,
  type ShareMutationResponse,
  type ShareResourceType,
  type SystemGroupKey,
  type UpsertShareRequest,
} from "@repo/zod-types";

import { mcpServersRepository, namespacesRepository } from "../db/repositories";
import { groupsRepository } from "../db/repositories/groups.repo";
import {
  ResourceSharesRepository,
  resourceSharesRepository,
} from "../db/repositories/resource-shares.repo";
import { usersRepository } from "../db/repositories/users.repo";
import { accessService } from "../lib/access/access.service";
import { endpointAccessCache } from "../lib/access/endpoint-access-cache";
import { loadOwners } from "../lib/access/owners";
import { hasCapability } from "../lib/access/policy";
import {
  checkEmbeddedCredentialRedistribution,
  checkNamespaceRedistribution,
} from "../lib/access/redistribution";
import { hasLevel } from "../lib/access/resource-guards";
import { activityLog } from "../lib/activity/activity-log.service";
import logger from "../utils/logger";

type LoadedResource = { uuid: string; name: string; user_id: string | null };

async function loadResource(
  ref: ResourceRef,
): Promise<LoadedResource | undefined> {
  if (ref.resourceType === "mcp_server") {
    return await mcpServersRepository.findByUuid(ref.resourceUuid);
  }
  return await namespacesRepository.findByUuid(ref.resourceUuid);
}

function asSystemKey(value: string | null): SystemGroupKey | null {
  return value === "admins" || value === "everyone" ? value : null;
}

async function requireManage(
  principal: AccessPrincipal,
  type: ShareResourceType,
  resource: LoadedResource | undefined,
) {
  if (!resource) return null;
  const access = await accessService.resolveAccessOne(
    principal,
    type,
    resource,
  );
  return access;
}

export const sharesImplementations = {
  list: async (
    input: ResourceRef,
    principal: AccessPrincipal,
  ): Promise<ListSharesResponse | null> => {
    const resource = await loadResource(input);
    const access = await requireManage(principal, input.resourceType, resource);
    if (!resource || !access) return null;

    const owners = await loadOwners([resource.user_id]);
    const canManage =
      hasLevel(access, "manage") && hasCapability(principal, "resources.share");

    // Only people who manage the resource see who else has access to it.
    const rows = hasLevel(access, "manage")
      ? await resourceSharesRepository.listForResource(
          input.resourceType,
          resource.uuid,
        )
      : [];
    const memberCounts = await Promise.all(
      rows.map((row) =>
        row.groupUuid
          ? resourceSharesRepository.countGroupMembers(row.groupUuid)
          : Promise.resolve(null),
      ),
    );

    return {
      resourceName: resource.name,
      owner: resource.user_id ? (owners.get(resource.user_id) ?? null) : null,
      access,
      canManage,
      shares: rows.map((row, index) => ({
        uuid: row.uuid,
        level: row.level,
        createdAt: row.createdAt,
        subject: {
          ...ResourceSharesRepository.toSubject(row),
          memberCount:
            row.groupSystemKey === "everyone" ? null : memberCounts[index],
        },
      })),
    };
  },

  upsert: async (
    input: UpsertShareRequest,
    principal: AccessPrincipal,
  ): Promise<ShareMutationResponse> => {
    if (!hasCapability(principal, "resources.share")) {
      return {
        success: false,
        message: "Access denied: your role does not allow sharing resources.",
      };
    }
    const resource = await loadResource(input);
    const access = await requireManage(principal, input.resourceType, resource);
    if (!resource || !access) {
      return { success: false, message: "Resource not found" };
    }
    if (!hasLevel(access, "manage")) {
      return {
        success: false,
        message:
          'Access denied: you need "manage" permission to share this resource.',
      };
    }

    let subject: { userId: string } | { groupUuid: string };
    let subjectLabel: string;
    if (input.subjectType === "user") {
      const user = await usersRepository.findById(input.subjectId);
      if (!user || user.disabled) {
        return { success: false, message: "User not found" };
      }
      if (user.id === resource.user_id) {
        return {
          success: false,
          message: "This user owns the resource and already has full access.",
        };
      }
      subject = { userId: user.id };
      subjectLabel = user.email;
    } else {
      const group = await groupsRepository.findByUuid(input.subjectId);
      if (!group) {
        return { success: false, message: "Group not found" };
      }
      if (
        group.system_key === "everyone" &&
        input.level !== "use" &&
        !principal.isAdmin
      ) {
        return {
          success: false,
          message:
            'Only administrators can give "edit" or "manage" access to everyone.',
        };
      }
      subject = { groupUuid: group.uuid };
      subjectLabel = group.system_key === "everyone" ? "Everyone" : group.name;
    }

    if (input.resourceType === "namespace") {
      const blocked = await checkNamespaceRedistribution(
        principal,
        resource.uuid,
      );
      if (blocked) return { success: false, message: blocked };
    } else {
      // A server pointing back at MetaMCP with stored credentials is a
      // namespace composition in disguise
      const server = await mcpServersRepository.findByUuid(resource.uuid);
      const blocked = server
        ? await checkEmbeddedCredentialRedistribution(principal, server)
        : null;
      if (blocked) return { success: false, message: blocked };
    }

    await resourceSharesRepository.upsert({
      type: input.resourceType,
      resourceUuid: resource.uuid,
      subject,
      level: input.level,
      createdBy: principal.userId,
    });
    endpointAccessCache.clear();
    logger.info(
      `User ${principal.userId} shared ${input.resourceType} ${resource.uuid} with ${input.subjectType} ${input.subjectId} (${input.level})`,
    );
    await activityLog.record({
      actor: principal,
      action: "share.granted",
      target: {
        type: input.resourceType,
        id: resource.uuid,
        label: resource.name,
      },
      details: {
        subjectType: input.subjectType,
        subject: subjectLabel,
        level: input.level,
      },
    });
    return { success: true, message: "Access updated" };
  },

  remove: async (
    input: RemoveShareRequest,
    principal: AccessPrincipal,
  ): Promise<ShareMutationResponse> => {
    const share = await resourceSharesRepository.findByUuid(input.shareUuid);
    if (!share) return { success: false, message: "Share not found" };

    const ref: ResourceRef = share.mcp_server_uuid
      ? { resourceType: "mcp_server", resourceUuid: share.mcp_server_uuid }
      : { resourceType: "namespace", resourceUuid: share.namespace_uuid ?? "" };
    const resource = await loadResource(ref);
    const access = await requireManage(principal, ref.resourceType, resource);

    // Anyone may leave a resource shared with them directly; otherwise
    // removing access requires managing the resource.
    const isOwnDirectShare = share.user_id === principal.userId;
    if (!isOwnDirectShare && !hasLevel(access, "manage")) {
      return {
        success: false,
        message:
          'Access denied: you need "manage" permission on this resource.',
      };
    }

    const subjectLabel = share.user_id
      ? ((await usersRepository.findById(share.user_id))?.email ??
        share.user_id)
      : await groupsRepository
          .findByUuid(share.group_uuid ?? "")
          .then((group) =>
            group?.system_key === "everyone"
              ? "Everyone"
              : (group?.name ?? share.group_uuid),
          );
    await resourceSharesRepository.delete(share.uuid);
    endpointAccessCache.clear();
    await activityLog.record({
      actor: principal,
      action: "share.revoked",
      target: {
        type: ref.resourceType,
        id: ref.resourceUuid,
        label: resource?.name ?? null,
      },
      details: {
        subjectType: share.user_id ? "user" : "group",
        subject: subjectLabel,
        level: share.level,
      },
    });
    logger.info(
      `User ${principal.userId} removed share ${share.uuid} on ${ref.resourceType} ${ref.resourceUuid}`,
    );
    return { success: true, message: "Access removed" };
  },

  searchSubjects: async (
    input: SearchShareSubjectsRequest,
    principal: AccessPrincipal,
  ): Promise<SearchShareSubjectsResponse> => {
    if (!hasCapability(principal, "resources.share")) {
      return { subjects: [] };
    }
    const query = input.query.trim().toLowerCase();
    const [groups, users] = await Promise.all([
      groupsRepository.list(),
      usersRepository.searchActive(query, input.limit, [principal.userId]),
    ]);
    const matchingGroups = groups
      .filter(
        (group) =>
          !query ||
          group.name.toLowerCase().includes(query) ||
          (group.description ?? "").toLowerCase().includes(query),
      )
      .slice(0, input.limit);

    return {
      subjects: [
        ...matchingGroups.map((group) => ({
          type: "group" as const,
          id: group.uuid,
          name: group.name,
          email: null,
          image: null,
          systemKey: asSystemKey(group.system_key),
          memberCount:
            group.system_key === "everyone" ? null : group.memberCount,
        })),
        ...users.map((user) => ({
          type: "user" as const,
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image ?? null,
          systemKey: null,
          memberCount: null,
        })),
      ],
    };
  },
};
