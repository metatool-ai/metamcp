import {
  ConfigKeyEnum,
  DEFAULT_ROLE_PERMISSIONS,
  type Role,
  RoleEnum,
  type RolePermissions,
  RolePermissionsSchema,
} from "@repo/zod-types";

import { configRepo } from "../../db/repositories/config.repo";

/**
 * RBAC settings stored in the `config` table, with env var fallbacks so they
 * can be provisioned declaratively:
 *   DEFAULT_USER_ROLE, OIDC_GROUPS_CLAIM, OIDC_SYNC_GROUPS,
 *   OIDC_REQUIRE_GROUP_MATCH.
 *
 * Values are cached for a few seconds because the role matrix is read on every
 * authenticated request.
 */

const CACHE_TTL_MS = 10_000;

type CacheEntry = { value: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

export function clearAccessSettingsCache(): void {
  cache.clear();
}

export const accessSettings = {
  async getDefaultRole(): Promise<Role> {
    return cached("defaultRole", async () => {
      const stored = await configRepo.getConfig(
        ConfigKeyEnum.enum.DEFAULT_USER_ROLE,
      );
      const parsed = RoleEnum.safeParse(
        stored?.value ?? process.env.DEFAULT_USER_ROLE ?? "viewer",
      );
      return parsed.success ? parsed.data : "viewer";
    });
  },

  async setDefaultRole(role: Role): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.enum.DEFAULT_USER_ROLE,
      role,
      "Base role given to newly created users",
    );
    clearAccessSettingsCache();
  },

  async getRolePermissions(): Promise<RolePermissions> {
    return cached("rolePermissions", async () => {
      const stored = await configRepo.getConfig(
        ConfigKeyEnum.enum.ROLE_PERMISSIONS,
      );
      if (!stored?.value) {
        return DEFAULT_ROLE_PERMISSIONS;
      }
      try {
        const parsed = RolePermissionsSchema.safeParse(
          JSON.parse(stored.value),
        );
        return parsed.success ? parsed.data : DEFAULT_ROLE_PERMISSIONS;
      } catch {
        return DEFAULT_ROLE_PERMISSIONS;
      }
    });
  },

  async setRolePermissions(permissions: RolePermissions): Promise<void> {
    const normalized = RolePermissionsSchema.parse({
      editor: [...new Set(permissions.editor)],
      viewer: [...new Set(permissions.viewer)],
    });
    await configRepo.setConfig(
      ConfigKeyEnum.enum.ROLE_PERMISSIONS,
      JSON.stringify(normalized),
      "Capabilities granted to the editor and viewer roles",
    );
    clearAccessSettingsCache();
  },

  async getOidcGroupsClaim(): Promise<string> {
    return cached("oidcGroupsClaim", async () => {
      const stored = await configRepo.getConfig(
        ConfigKeyEnum.enum.OIDC_GROUPS_CLAIM,
      );
      const value = (
        stored?.value ??
        process.env.OIDC_GROUPS_CLAIM ??
        "groups"
      ).trim();
      return value.length > 0 ? value : "groups";
    });
  },

  async getOidcSyncGroups(): Promise<boolean> {
    return cached("oidcSyncGroups", async () => {
      const stored = await configRepo.getConfig(
        ConfigKeyEnum.enum.OIDC_SYNC_GROUPS,
      );
      return parseBoolean(stored?.value ?? process.env.OIDC_SYNC_GROUPS, true);
    });
  },

  async getOidcRequireGroupMatch(): Promise<boolean> {
    return cached("oidcRequireGroupMatch", async () => {
      const stored = await configRepo.getConfig(
        ConfigKeyEnum.enum.OIDC_REQUIRE_GROUP_MATCH,
      );
      return parseBoolean(
        stored?.value ?? process.env.OIDC_REQUIRE_GROUP_MATCH,
        false,
      );
    });
  },

  async setOidcSettings(input: {
    groupsClaim?: string;
    syncGroups?: boolean;
    requireGroupMatch?: boolean;
  }): Promise<void> {
    if (input.groupsClaim !== undefined) {
      await configRepo.setConfig(
        ConfigKeyEnum.enum.OIDC_GROUPS_CLAIM,
        input.groupsClaim.trim(),
        "OIDC claim holding the user's groups",
      );
    }
    if (input.syncGroups !== undefined) {
      await configRepo.setConfig(
        ConfigKeyEnum.enum.OIDC_SYNC_GROUPS,
        String(input.syncGroups),
        "Re-sync OIDC group memberships at every SSO login",
      );
    }
    if (input.requireGroupMatch !== undefined) {
      await configRepo.setConfig(
        ConfigKeyEnum.enum.OIDC_REQUIRE_GROUP_MATCH,
        String(input.requireGroupMatch),
        "Refuse SSO logins whose groups match no MetaMCP group",
      );
    }
    clearAccessSettingsCache();
  },

  /** Emails that are always administrators (break-glass / first admin), from ADMIN_EMAILS. */
  getAdminEmails(): string[] {
    return (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  },
};
