import {
  type AccessPrincipal,
  type AddGroupMembersRequest,
  type AdminMutationResponse,
  type AdminUser,
  type CreateGroupRequest,
  type CreateUserRequest,
  type DeleteUserRequest,
  type EncryptionStatus,
  type ExportActivityResponse,
  type Group,
  type GroupDetail,
  type GroupUuidRequest,
  type ListActivityRequest,
  type ListActivityResponse,
  type ListUsersRequest,
  type ListUsersResponse,
  type RemoveGroupMemberRequest,
  type RolePermissions,
  type RotateDataKeyResponse,
  type SetUserDisabledRequest,
  type SetUserPasswordRequest,
  type SsoSettings,
  type SystemGroupKey,
  type TestSsoMappingRequest,
  type TestSsoMappingResponse,
  type UpdateGroupRequest,
  type UpdateSsoSettingsRequest,
  type UpdateUserRequest,
  type UserIdRequest,
} from "@repo/zod-types";

import { auth } from "../auth";
import {
  type DatabaseGroup,
  groupsRepository,
  type GroupWithCounts,
} from "../db/repositories/groups.repo";
import { resourceSharesRepository } from "../db/repositories/resource-shares.repo";
import {
  type DatabaseUser,
  usersRepository,
} from "../db/repositories/users.repo";
import { accessService } from "../lib/access/access.service";
import { accessSettings } from "../lib/access/access-settings";
import { checkAdminRemains, guardAdminChange } from "../lib/access/admin-guard";
import { runWithAuthRequestContext } from "../lib/access/auth-request-context";
import { endpointAccessCache } from "../lib/access/endpoint-access-cache";
import { oidcSyncService } from "../lib/access/oidc-sync.service";
import { resolveEffectiveRole } from "../lib/access/policy";
import { activityLog, diffFields } from "../lib/activity/activity-log.service";
import { publicErrorMessage } from "../lib/errors";
import { secretsService } from "../lib/secrets/secrets.service";
import logger from "../utils/logger";

const userTarget = (user: { id: string; email: string }) => ({
  type: "user",
  id: user.id,
  label: user.email,
});
const groupTarget = (group: { uuid: string; name: string }) => ({
  type: "group",
  id: group.uuid,
  label: group.name,
});

const ok = (message?: string): AdminMutationResponse => ({
  success: true,
  message,
});
const fail = (message: string): AdminMutationResponse => ({
  success: false,
  message,
});

function asSystemKey(value: string | null): SystemGroupKey | null {
  return value === "admins" || value === "everyone" ? value : null;
}

async function toAdminUsers(users: DatabaseUser[]): Promise<AdminUser[]> {
  const ids = users.map((user) => user.id);
  const [memberships, authMethods, lastSeen, counts, everyone] =
    await Promise.all([
      groupsRepository.getMembershipsForUsers(ids),
      usersRepository.getAuthMethods(ids),
      usersRepository.getLastSeen(ids),
      usersRepository.getResourceCounts(ids),
      accessService.getEveryoneGroup(),
    ]);

  return users.map((user) => {
    const groups = memberships.get(user.id) ?? [];
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      baseRole: user.role,
      role: resolveEffectiveRole(user.role, [
        ...groups.map((group) => group.role),
        everyone?.role,
      ]),
      disabled: user.disabled,
      disabledAt: user.disabledAt ?? null,
      groups: groups.map((group) => ({
        uuid: group.groupUuid,
        name: group.name,
        role: group.role,
        systemKey: group.systemKey,
        source: group.source,
      })),
      authMethods: authMethods.get(user.id) ?? [],
      externalGroups: user.externalGroups ?? [],
      externalGroupsSyncedAt: user.externalGroupsSyncedAt ?? null,
      createdAt: user.createdAt,
      lastSeenAt: lastSeen.get(user.id) ?? null,
      resourceCounts: counts.get(user.id) ?? {
        mcpServers: 0,
        namespaces: 0,
        endpoints: 0,
        apiKeys: 0,
      },
    };
  });
}

function toGroup(group: GroupWithCounts): Group {
  return {
    uuid: group.uuid,
    name: group.name,
    description: group.description,
    role: group.role,
    systemKey: asSystemKey(group.system_key),
    oidcGroups: group.oidc_groups,
    memberCount: group.memberCount,
    shareCount: group.shareCount,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
  };
}

function normalizeOidcGroups(
  values: string[] | undefined,
): string[] | undefined {
  if (!values) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase());
      result.push(trimmed);
    }
  }
  return result;
}

/** Validates role/mapping constraints of the two system groups. */
function validateSystemGroup(
  group: DatabaseGroup,
  patch: { name?: string; role?: DatabaseGroup["role"]; oidcGroups?: string[] },
): string | null {
  if (
    group.system_key === "admins" &&
    patch.role !== undefined &&
    patch.role !== "admin"
  ) {
    return 'The "Administrators" group always grants the admin role.';
  }
  if (group.system_key === "everyone") {
    if (patch.role === "admin") {
      return 'The "Everyone" group cannot grant the admin role.';
    }
    if (patch.oidcGroups && patch.oidcGroups.length > 0) {
      return 'Every user already belongs to "Everyone"; it cannot be mapped to IdP groups.';
    }
  }
  if (
    group.system_key &&
    patch.name !== undefined &&
    patch.name.trim() !== group.name
  ) {
    return "System groups cannot be renamed.";
  }
  return null;
}

async function createCredentialUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<string> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  // Administrator-created accounts bypass the self-service sign-up switches.
  return await runWithAuthRequestContext(
    { bypassSignupRestrictions: true },
    async () => {
      const user = await ctx.internalAdapter.createUser({
        name: input.name,
        email: input.email,
        emailVerified: true,
      });
      if (!user) {
        throw new Error("Failed to create user");
      }
      await ctx.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: hash,
      });
      return user.id;
    },
  );
}

export const adminImplementations = {
  users: {
    list: async (
      input: ListUsersRequest,
      _principal: AccessPrincipal,
    ): Promise<ListUsersResponse> => {
      const { users, total } = await usersRepository.list({
        search: input.search,
        role: input.role,
        status: input.status,
        groupUuid: input.groupUuid,
        limit: input.limit,
        offset: input.offset,
      });
      return { users: await toAdminUsers(users), total };
    },

    get: async (
      input: UserIdRequest,
      _principal: AccessPrincipal,
    ): Promise<AdminUser | null> => {
      const user = await usersRepository.findById(input.id);
      if (!user) return null;
      const [result] = await toAdminUsers([user]);
      return result ?? null;
    },

    create: async (
      input: CreateUserRequest,
      principal: AccessPrincipal,
    ): Promise<AdminMutationResponse> => {
      if (await usersRepository.findByEmail(input.email)) {
        return fail("A user with this email already exists.");
      }
      try {
        const userId = await createCredentialUser(input);
        await usersRepository.setRole(userId, input.baseRole);
        for (const groupUuid of input.groupUuids) {
          const group = await groupsRepository.findByUuid(groupUuid);
          if (group && group.system_key !== "everyone") {
            await groupsRepository.addMembers(groupUuid, [userId], "manual");
          }
        }
        accessService.invalidateUser(userId);
        logger.info(`Admin ${principal.userId} created user ${userId}`);
        const groups = await groupsRepository.getMembershipsForUser(userId);
        await activityLog.record({
          actor: principal,
          action: "user.created",
          target: userTarget({ id: userId, email: input.email }),
          details: {
            name: input.name,
            baseRole: input.baseRole,
            groups: groups.map((group) => group.name),
          },
        });
        return ok("User created");
      } catch (error) {
        logger.error("Error creating user:", error);
        return fail(publicErrorMessage(error, "Failed to create user"));
      }
    },

    update: guardAdminChange(
      async (
        input: UpdateUserRequest,
        principal: AccessPrincipal,
      ): Promise<AdminMutationResponse> => {
        const user = await usersRepository.findById(input.id);
        if (!user) return fail("User not found");

        if (input.baseRole !== undefined && input.baseRole !== user.role) {
          const blocked = await checkAdminRemains({
            kind: "setBaseRole",
            userId: user.id,
            role: input.baseRole,
          });
          if (blocked) return fail(blocked);
        }

        await usersRepository.update(user.id, {
          name: input.name,
          role: input.baseRole,
        });
        accessService.invalidateUser(user.id);
        const changes = diffFields(
          { name: user.name, baseRole: user.role },
          { name: input.name, baseRole: input.baseRole },
          ["name", "baseRole"],
        );
        if (Object.keys(changes).length > 0) {
          await activityLog.record({
            actor: principal,
            action: "user.updated",
            target: userTarget(user),
            details: { changes },
          });
        }
        logger.info(
          `Admin ${principal.userId} updated user ${user.id}${input.baseRole ? ` (base role ${input.baseRole})` : ""}`,
        );
        return ok("User updated");
      },
    ),

    setPassword: async (
      input: SetUserPasswordRequest,
      principal: AccessPrincipal,
    ): Promise<AdminMutationResponse> => {
      const user = await usersRepository.findById(input.id);
      if (!user) return fail("User not found");
      const ctx = await auth.$context;
      const hash = await ctx.password.hash(input.password);
      const accounts = await ctx.internalAdapter.findAccounts(user.id);
      if (accounts.some((account) => account.providerId === "credential")) {
        await ctx.internalAdapter.updatePassword(user.id, hash);
      } else {
        // SSO-only user: add an email/password sign-in method.
        await ctx.internalAdapter.linkAccount({
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: hash,
        });
      }
      // Force other devices to sign in again with the new password.
      await usersRepository.revokeSessions(user.id);
      logger.info(`Admin ${principal.userId} reset the password of ${user.id}`);
      await activityLog.record({
        actor: principal,
        action: "user.password_reset",
        target: userTarget(user),
      });
      return ok("Password updated");
    },

    setDisabled: guardAdminChange(
      async (
        input: SetUserDisabledRequest,
        principal: AccessPrincipal,
      ): Promise<AdminMutationResponse> => {
        if (input.id === principal.userId && input.disabled) {
          return fail("You cannot disable your own account.");
        }
        const user = await usersRepository.findById(input.id);
        if (!user) return fail("User not found");
        if (input.disabled) {
          const blocked = await checkAdminRemains({
            kind: "disableUser",
            userId: user.id,
          });
          if (blocked) return fail(blocked);
        }
        await usersRepository.setDisabled(user.id, input.disabled);
        accessService.invalidateUser(user.id);
        await activityLog.record({
          actor: principal,
          action: input.disabled ? "user.disabled" : "user.enabled",
          target: userTarget(user),
        });
        logger.info(
          `Admin ${principal.userId} ${input.disabled ? "disabled" : "enabled"} user ${user.id}`,
        );
        return ok(input.disabled ? "User disabled" : "User enabled");
      },
    ),

    revokeSessions: async (
      input: UserIdRequest,
      principal: AccessPrincipal,
    ): Promise<AdminMutationResponse> => {
      const user = await usersRepository.findById(input.id);
      if (!user) return fail("User not found");
      await usersRepository.revokeSessions(user.id);
      logger.info(`Admin ${principal.userId} revoked sessions of ${user.id}`);
      await activityLog.record({
        actor: principal,
        action: "user.sessions_revoked",
        target: userTarget(user),
      });
      return ok("Sessions revoked");
    },

    delete: guardAdminChange(
      async (
        input: DeleteUserRequest,
        principal: AccessPrincipal,
      ): Promise<AdminMutationResponse> => {
        if (input.id === principal.userId) {
          return fail("You cannot delete your own account.");
        }
        const user = await usersRepository.findById(input.id);
        if (!user) return fail("User not found");

        const blocked = await checkAdminRemains({
          kind: "deleteUser",
          userId: user.id,
        });
        if (blocked) return fail(blocked);

        let transfer:
          | { mode: "delete" }
          | { mode: "owner"; ownerId: string | null } = { mode: "delete" };
        let transferTo: string | null = null;
        if (input.transfer.mode === "organization") {
          transfer = { mode: "owner", ownerId: null };
        } else if (input.transfer.mode === "user") {
          if (input.transfer.userId === user.id) {
            return fail("Choose another user to receive the resources.");
          }
          const target = await usersRepository.findById(input.transfer.userId);
          if (!target)
            return fail("The user receiving the resources was not found.");
          transfer = { mode: "owner", ownerId: target.id };
          transferTo = target.email;
        }

        if (transfer.mode === "owner") {
          const conflicts = await usersRepository.findTransferConflicts(
            user.id,
            transfer.ownerId,
          );
          const names = [...conflicts.mcpServers, ...conflicts.namespaces];
          if (names.length > 0) {
            return fail(
              `Rename these resources first, the new owner already has resources with the same names: ${names.join(", ")}`,
            );
          }
        }

        await usersRepository.deleteWithTransfer(user.id, transfer);
        endpointAccessCache.clear(); // owner / namespace may have changed
        accessService.invalidateUser(user.id);
        await activityLog.record({
          actor: principal,
          action: "user.deleted",
          target: userTarget(user),
          details: {
            resources: input.transfer.mode,
            ...(transferTo ? { transferredTo: transferTo } : {}),
          },
        });
        logger.info(
          `Admin ${principal.userId} deleted user ${user.id} (resources: ${input.transfer.mode})`,
        );
        return ok("User deleted");
      },
    ),
  },

  groups: {
    list: async (_principal: AccessPrincipal): Promise<Group[]> => {
      return (await groupsRepository.list()).map(toGroup);
    },

    get: async (
      input: GroupUuidRequest,
      _principal: AccessPrincipal,
    ): Promise<GroupDetail | null> => {
      const groups = await groupsRepository.list();
      const group = groups.find((candidate) => candidate.uuid === input.uuid);
      if (!group) return null;
      const everyone = await accessService.getEveryoneGroup();
      const [members, shares] = await Promise.all([
        groupsRepository.listMembers(group.uuid),
        resourceSharesRepository.listForGroup(group.uuid),
      ]);
      const memberships = await groupsRepository.getMembershipsForUsers(
        members.map((member) => member.userId),
      );
      return {
        ...toGroup(group),
        members: members.map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
          image: member.image,
          role: resolveEffectiveRole(member.baseRole, [
            ...(memberships.get(member.userId) ?? []).map((m) => m.role),
            everyone?.role,
          ]),
          disabled: member.disabled,
          source: member.source,
          addedAt: member.addedAt,
        })),
        shares,
      };
    },

    create: async (
      input: CreateGroupRequest,
      principal: AccessPrincipal,
    ): Promise<AdminMutationResponse & { uuid?: string }> => {
      if (await groupsRepository.findByNameInsensitive(input.name)) {
        return fail("A group with this name already exists.");
      }
      const group = await groupsRepository.create({
        name: input.name,
        description: input.description ?? null,
        role: input.role,
        oidcGroups: normalizeOidcGroups(input.oidcGroups) ?? [],
      });
      if (input.memberIds.length > 0) {
        const users = await usersRepository.findByIds(input.memberIds);
        await groupsRepository.addMembers(
          group.uuid,
          users.map((user) => user.id),
          "manual",
        );
      }
      accessService.invalidateAll();
      logger.info(`Admin ${principal.userId} created group ${group.uuid}`);
      await activityLog.record({
        actor: principal,
        action: "group.created",
        target: groupTarget(group),
        details: {
          role: input.role ?? null,
          idpGroups: normalizeOidcGroups(input.oidcGroups) ?? [],
          members: input.memberIds.length,
        },
      });
      return { ...ok("Group created"), uuid: group.uuid };
    },

    update: guardAdminChange(
      async (
        input: UpdateGroupRequest,
        principal: AccessPrincipal,
      ): Promise<AdminMutationResponse> => {
        const group = await groupsRepository.findByUuid(input.uuid);
        if (!group) return fail("Group not found");

        const oidcGroups = normalizeOidcGroups(input.oidcGroups);
        const invalid = validateSystemGroup(group, {
          name: input.name,
          role: input.role,
          oidcGroups,
        });
        if (invalid) return fail(invalid);

        if (input.name !== undefined && input.name.trim() !== group.name) {
          const existing = await groupsRepository.findByNameInsensitive(
            input.name,
          );
          if (existing && existing.uuid !== group.uuid) {
            return fail("A group with this name already exists.");
          }
        }
        if (input.role !== undefined && input.role !== group.role) {
          const blocked = await checkAdminRemains({
            kind: "setGroupRole",
            groupUuid: group.uuid,
            role: input.role,
          });
          if (blocked) return fail(blocked);
        }

        await groupsRepository.update(group.uuid, {
          name: input.name,
          description: input.description,
          role: input.role,
          oidcGroups,
        });
        accessService.invalidateAll();
        const changes = diffFields(
          {
            name: group.name,
            description: group.description,
            role: group.role,
            idpGroups: group.oidc_groups,
          },
          {
            name: input.name?.trim(),
            description: input.description,
            role: input.role,
            idpGroups: oidcGroups,
          },
          ["name", "description", "role", "idpGroups"],
        );
        if (Object.keys(changes).length > 0) {
          await activityLog.record({
            actor: principal,
            action: "group.updated",
            target: groupTarget(group),
            details: { changes },
          });
        }
        logger.info(`Admin ${principal.userId} updated group ${group.uuid}`);
        return ok("Group updated");
      },
    ),

    delete: guardAdminChange(
      async (
        input: GroupUuidRequest,
        principal: AccessPrincipal,
      ): Promise<AdminMutationResponse> => {
        const group = await groupsRepository.findByUuid(input.uuid);
        if (!group) return fail("Group not found");
        if (group.system_key) {
          return fail("System groups cannot be deleted.");
        }
        const blocked = await checkAdminRemains({
          kind: "deleteGroup",
          groupUuid: group.uuid,
        });
        if (blocked) return fail(blocked);
        await groupsRepository.delete(group.uuid);
        accessService.invalidateAll();
        await activityLog.record({
          actor: principal,
          action: "group.deleted",
          target: groupTarget(group),
          details: { role: group.role },
        });
        logger.info(`Admin ${principal.userId} deleted group ${group.uuid}`);
        return ok("Group deleted");
      },
    ),

    addMembers: async (
      input: AddGroupMembersRequest,
      principal: AccessPrincipal,
    ): Promise<AdminMutationResponse> => {
      const group = await groupsRepository.findByUuid(input.groupUuid);
      if (!group) return fail("Group not found");
      if (group.system_key === "everyone") {
        return fail('Every user already belongs to "Everyone".');
      }
      const users = await usersRepository.findByIds(input.userIds);
      if (users.length === 0) return fail("No matching users");
      await groupsRepository.addMembers(
        group.uuid,
        users.map((user) => user.id),
        "manual",
      );
      users.forEach((user) => accessService.invalidateUser(user.id));
      logger.info(
        `Admin ${principal.userId} added ${users.length} member(s) to group ${group.uuid}`,
      );
      await activityLog.record({
        actor: principal,
        action: "group.members_added",
        target: groupTarget(group),
        details: {
          count: users.length,
          members: users.slice(0, 50).map((user) => user.email),
        },
      });
      return ok(`${users.length} member(s) added`);
    },

    removeMember: guardAdminChange(
      async (
        input: RemoveGroupMemberRequest,
        principal: AccessPrincipal,
      ): Promise<AdminMutationResponse> => {
        const group = await groupsRepository.findByUuid(input.groupUuid);
        if (!group) return fail("Group not found");
        const blocked = await checkAdminRemains({
          kind: "removeMembership",
          userId: input.userId,
          groupUuid: group.uuid,
        });
        if (blocked) return fail(blocked);
        const removed = await groupsRepository.removeMember(
          group.uuid,
          input.userId,
        );
        accessService.invalidateUser(input.userId);
        if (!removed) return fail("This user is not a member of the group");
        const member = await usersRepository.findById(input.userId);
        await activityLog.record({
          actor: principal,
          action: "group.member_removed",
          target: groupTarget(group),
          details: { member: member?.email ?? input.userId },
        });
        logger.info(
          `Admin ${principal.userId} removed ${input.userId} from group ${group.uuid}`,
        );
        return ok("Member removed");
      },
    ),
  },

  roles: {
    getPermissions: async (): Promise<RolePermissions> => {
      return await accessSettings.getRolePermissions();
    },
    setPermissions: async (
      input: RolePermissions,
      principal: AccessPrincipal,
    ): Promise<AdminMutationResponse> => {
      const before = await accessSettings.getRolePermissions();
      await accessSettings.setRolePermissions(input);
      accessService.invalidateAll();
      const changes = diffFields(before, input, ["editor", "viewer"]);
      if (Object.keys(changes).length > 0) {
        await activityLog.record({
          actor: principal,
          action: "roles.permissions_updated",
          target: { type: "roles", id: null, label: null },
          details: { changes },
        });
      }
      logger.info(`Admin ${principal.userId} updated the role permissions`);
      return ok("Permissions updated");
    },
  },

  sso: {
    getSettings: async (): Promise<SsoSettings> => {
      const [groupsClaim, syncGroups, requireGroupMatch, defaultRole] =
        await Promise.all([
          accessSettings.getOidcGroupsClaim(),
          accessSettings.getOidcSyncGroups(),
          accessSettings.getOidcRequireGroupMatch(),
          accessSettings.getDefaultRole(),
        ]);
      const oidcConfigured = Boolean(
        process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET,
      );
      return {
        oidcConfigured,
        providerId: oidcConfigured
          ? process.env.OIDC_PROVIDER_ID || "oidc"
          : null,
        groupsClaim,
        syncGroups,
        requireGroupMatch,
        defaultRole,
      };
    },
    updateSettings: async (
      input: UpdateSsoSettingsRequest,
      principal: AccessPrincipal,
    ): Promise<AdminMutationResponse> => {
      const before = {
        groupsClaim: await accessSettings.getOidcGroupsClaim(),
        syncGroups: await accessSettings.getOidcSyncGroups(),
        requireGroupMatch: await accessSettings.getOidcRequireGroupMatch(),
        defaultRole: await accessSettings.getDefaultRole(),
      };
      await accessSettings.setOidcSettings({
        groupsClaim: input.groupsClaim,
        syncGroups: input.syncGroups,
        requireGroupMatch: input.requireGroupMatch,
      });
      if (input.defaultRole) {
        await accessSettings.setDefaultRole(input.defaultRole);
      }
      const changes = diffFields(before, input, [
        "groupsClaim",
        "syncGroups",
        "requireGroupMatch",
        "defaultRole",
      ]);
      if (Object.keys(changes).length > 0) {
        await activityLog.record({
          actor: principal,
          action: "sso.settings_updated",
          target: { type: "sso", id: null, label: null },
          details: { changes },
        });
      }
      logger.info(`Admin ${principal.userId} updated the SSO settings`);
      return ok("Settings updated");
    },
    testMapping: async (
      input: TestSsoMappingRequest,
      _principal: AccessPrincipal,
    ): Promise<TestSsoMappingResponse> => {
      return await oidcSyncService.testMapping(input.groups);
    },
  },

  activity: {
    list: async (
      input: ListActivityRequest,
      _principal: AccessPrincipal,
    ): Promise<ListActivityResponse> => {
      return await activityLog.list(input);
    },
    export: async (
      input: ListActivityRequest,
      _principal: AccessPrincipal,
    ): Promise<ExportActivityResponse> => {
      const { offset: _offset, limit: _limit, ...filters } = input;
      return await activityLog.exportCsv(filters);
    },
  },

  security: {
    getEncryptionStatus: async (): Promise<EncryptionStatus> => {
      return await secretsService.getStatus();
    },
    rotateDataKey: async (
      principal: AccessPrincipal,
    ): Promise<RotateDataKeyResponse> => {
      try {
        const { keyId, activatesAt } = await secretsService.rotateDataKey();
        await activityLog.record({
          actor: principal,
          action: "secrets.data_key_rotated",
          target: { type: "encryption_key", id: keyId, label: keyId },
          details: { activatesAt: activatesAt.toISOString() },
        });
        return {
          success: true,
          message: "Data key created",
          keyId,
          activatesAt,
        };
      } catch (error) {
        logger.error("Data key rotation failed:", error);
        return {
          success: false,
          message: publicErrorMessage(error, "Data key rotation failed"),
        };
      }
    },
  },
};
