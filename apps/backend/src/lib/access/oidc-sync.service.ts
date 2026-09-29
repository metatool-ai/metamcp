import type { Role, TestSsoMappingResponse } from "@repo/zod-types";

import { groupsRepository } from "../../db/repositories/groups.repo";
import { usersRepository } from "../../db/repositories/users.repo";
import logger from "../../utils/logger";
import { activityLog } from "../activity/activity-log.service";
import { accessService } from "./access.service";
import { accessSettings } from "./access-settings";
import {
  diffOidcMemberships,
  type GroupMatch,
  resolveMappedGroups,
} from "./oidc-groups";
import { resolveEffectiveRole } from "./policy";

async function computeMatches(externalGroups: string[]): Promise<{
  matches: GroupMatch[];
  groupsByUuid: Map<string, { name: string; role: Role | null }>;
}> {
  const mapped = await groupsRepository.findMapped();
  const everyone = await accessService.getEveryoneGroup();
  const candidates = mapped.filter((group) => group.uuid !== everyone?.uuid);
  const matches = resolveMappedGroups(
    externalGroups,
    candidates.map((group) => ({
      uuid: group.uuid,
      oidcGroups: group.oidc_groups,
    })),
  );
  return {
    matches,
    groupsByUuid: new Map(
      candidates.map((group) => [
        group.uuid,
        { name: group.name, role: group.role },
      ]),
    ),
  };
}

export const oidcSyncService = {
  /**
   * Whether an SSO login carrying these groups may proceed. With "require a
   * group match" enabled, an absent claim fails closed.
   */
  async isLoginAllowed(externalGroups: string[] | null): Promise<boolean> {
    if (!(await accessSettings.getOidcRequireGroupMatch())) {
      return true;
    }
    if (externalGroups === null) {
      return false;
    }
    const { matches } = await computeMatches(externalGroups);
    return matches.length > 0;
  },

  /**
   * Records the IdP groups on the user and aligns OIDC-sourced memberships
   * with the configured mappings. Manual memberships are left untouched.
   */
  async syncUser(
    userId: string,
    externalGroups: string[] | null,
  ): Promise<void> {
    if (externalGroups === null) {
      // Keep the current memberships: a missing claim (misconfigured mapper,
      // Entra ID overage, thin ID token) is not the same as "no groups".
      logger.warn(
        `SSO login for user ${userId} carried no groups claim; group memberships left unchanged. Check the OIDC groups claim setting.`,
      );
      return;
    }
    await usersRepository.setExternalGroups(userId, externalGroups);
    if (!(await accessSettings.getOidcSyncGroups())) {
      return;
    }

    const { matches, groupsByUuid } = await computeMatches(externalGroups);
    const current = await groupsRepository.getMembershipsForUser(userId);
    const everyone = await accessService.getEveryoneGroup();
    const { toAdd, toRemove } = diffOidcMemberships({
      matchedGroupUuids: matches.map((match) => match.groupUuid),
      currentMemberships: current.map((membership) => ({
        groupUuid: membership.groupUuid,
        source: membership.source,
      })),
      excludedGroupUuids: everyone ? [everyone.uuid] : [],
    });

    for (const groupUuid of toAdd) {
      await groupsRepository.addMembers(groupUuid, [userId], "oidc");
    }
    await groupsRepository.removeMemberships(userId, toRemove, "oidc");

    if (toAdd.length > 0 || toRemove.length > 0) {
      logger.info(
        `SSO group sync for user ${userId}: +${toAdd.length} / -${toRemove.length} memberships`,
      );
      const user = await usersRepository.findById(userId);
      const nameOf = (groupUuid: string) =>
        groupsByUuid.get(groupUuid)?.name ??
        current.find((membership) => membership.groupUuid === groupUuid)
          ?.name ??
        groupUuid;
      await activityLog.record({
        actor: { kind: "system", label: "SSO group sync" },
        action: "group.memberships_synced",
        target: { type: "user", id: userId, label: user?.email ?? null },
        details: {
          added: toAdd.map(nameOf),
          removed: toRemove.map(nameOf),
          idpGroups: externalGroups.slice(0, 50),
        },
      });
    }
    accessService.invalidateUser(userId);
  },

  /** Dry-run used by the admin UI to debug a mapping. */
  async testMapping(externalGroups: string[]): Promise<TestSsoMappingResponse> {
    const [{ matches, groupsByUuid }, defaultRole, requireMatch, everyone] =
      await Promise.all([
        computeMatches(externalGroups),
        accessSettings.getDefaultRole(),
        accessSettings.getOidcRequireGroupMatch(),
        accessService.getEveryoneGroup(),
      ]);

    const resultingRole = resolveEffectiveRole(defaultRole, [
      ...matches.map((match) => groupsByUuid.get(match.groupUuid)?.role),
      everyone?.role,
    ]);

    return {
      matches: matches.map((match) => ({
        groupUuid: match.groupUuid,
        groupName: groupsByUuid.get(match.groupUuid)?.name ?? "",
        role: groupsByUuid.get(match.groupUuid)?.role ?? null,
        matchedBy: match.matchedBy,
      })),
      resultingRole,
      denied: requireMatch && matches.length === 0,
    };
  },
};
