import { type AccessPrincipal, SetConfigRequest } from "@repo/zod-types";
import { TRPCError } from "@trpc/server";

import { activityLog } from "../lib/activity/activity-log.service";
import { configService } from "../lib/config.service";

/** Keys the generic setConfig must not write (see setConfig). */
const DEDICATED_SETTINGS: ReadonlySet<string> = new Set([
  "DEFAULT_USER_ROLE",
  "ROLE_PERMISSIONS",
  "OIDC_GROUPS_CLAIM",
  "OIDC_SYNC_GROUPS",
  "OIDC_REQUIRE_GROUP_MATCH",
]);

/** Records a settings change made by an administrator (UI or admin tools). */
async function recordSetting(
  principal: AccessPrincipal | undefined,
  key: string,
  from: unknown,
  to: unknown,
): Promise<void> {
  if (!principal || JSON.stringify(from) === JSON.stringify(to)) return;
  await activityLog.record({
    actor: principal,
    action: "settings.updated",
    target: { type: "setting", id: key, label: key },
    details: { changes: { [key]: { from, to } } },
  });
}

export const configImplementations = {
  getSignupDisabled: async (): Promise<boolean> => {
    return await configService.isSignupDisabled();
  },

  setSignupDisabled: async (
    input: {
      disabled: boolean;
    },
    principal?: AccessPrincipal,
  ): Promise<{ success: boolean }> => {
    const before = await configService.isSignupDisabled();
    await configService.setSignupDisabled(input.disabled);
    await recordSetting(principal, "DISABLE_SIGNUP", before, input.disabled);
    return { success: true };
  },

  getSsoSignupDisabled: async (): Promise<boolean> => {
    return await configService.isSsoSignupDisabled();
  },

  setSsoSignupDisabled: async (
    input: {
      disabled: boolean;
    },
    principal?: AccessPrincipal,
  ): Promise<{ success: boolean }> => {
    const before = await configService.isSsoSignupDisabled();
    await configService.setSsoSignupDisabled(input.disabled);
    await recordSetting(
      principal,
      "DISABLE_SSO_SIGNUP",
      before,
      input.disabled,
    );
    return { success: true };
  },

  getBasicAuthDisabled: async (): Promise<boolean> => {
    return await configService.isBasicAuthDisabled();
  },

  setBasicAuthDisabled: async (
    input: {
      disabled: boolean;
    },
    principal?: AccessPrincipal,
  ): Promise<{ success: boolean }> => {
    const before = await configService.isBasicAuthDisabled();
    await configService.setBasicAuthDisabled(input.disabled);
    await recordSetting(
      principal,
      "DISABLE_BASIC_AUTH",
      before,
      input.disabled,
    );
    return { success: true };
  },

  getMcpResetTimeoutOnProgress: async (): Promise<boolean> => {
    return await configService.getMcpResetTimeoutOnProgress();
  },

  setMcpResetTimeoutOnProgress: async (
    input: {
      enabled: boolean;
    },
    principal?: AccessPrincipal,
  ): Promise<{ success: boolean }> => {
    const before = await configService.getMcpResetTimeoutOnProgress();
    await configService.setMcpResetTimeoutOnProgress(input.enabled);
    await recordSetting(
      principal,
      "MCP_RESET_TIMEOUT_ON_PROGRESS",
      before,
      input.enabled,
    );
    return { success: true };
  },

  getMcpTimeout: async (): Promise<number> => {
    return await configService.getMcpTimeout();
  },

  setMcpTimeout: async (
    input: {
      timeout: number;
    },
    principal?: AccessPrincipal,
  ): Promise<{ success: boolean }> => {
    const before = await configService.getMcpTimeout();
    await configService.setMcpTimeout(input.timeout);
    await recordSetting(principal, "MCP_TIMEOUT", before, input.timeout);
    return { success: true };
  },

  getMcpMaxTotalTimeout: async (): Promise<number> => {
    return await configService.getMcpMaxTotalTimeout();
  },

  setMcpMaxTotalTimeout: async (
    input: {
      timeout: number;
    },
    principal?: AccessPrincipal,
  ): Promise<{ success: boolean }> => {
    const before = await configService.getMcpMaxTotalTimeout();
    await configService.setMcpMaxTotalTimeout(input.timeout);
    await recordSetting(
      principal,
      "MCP_MAX_TOTAL_TIMEOUT",
      before,
      input.timeout,
    );
    return { success: true };
  },

  getMcpMaxAttempts: async (): Promise<number> => {
    return await configService.getMcpMaxAttempts();
  },

  setMcpMaxAttempts: async (
    input: {
      maxAttempts: number;
    },
    principal?: AccessPrincipal,
  ): Promise<{ success: boolean }> => {
    const before = await configService.getMcpMaxAttempts();
    await configService.setMcpMaxAttempts(input.maxAttempts);
    await recordSetting(
      principal,
      "MCP_MAX_ATTEMPTS",
      before,
      input.maxAttempts,
    );
    return { success: true };
  },

  getSessionLifetime: async (): Promise<number | null> => {
    return await configService.getSessionLifetime();
  },

  setSessionLifetime: async (
    input: {
      lifetime?: number | null;
    },
    principal?: AccessPrincipal,
  ): Promise<{ success: boolean }> => {
    const before = await configService.getSessionLifetime();
    await configService.setSessionLifetime(input.lifetime);
    await recordSetting(
      principal,
      "SESSION_LIFETIME",
      before,
      input.lifetime ?? null,
    );
    return { success: true };
  },

  getAllConfigs: async (): Promise<
    Array<{ id: string; value: string; description?: string | null }>
  > => {
    // Never expose bootstrap password fingerprints, even to administrators.
    return (await configService.getAllConfigs()).filter(
      (config) => !config.id.startsWith("BOOTSTRAP_USER_PASSWORD_FINGERPRINT"),
    );
  },

  setConfig: async (
    input: SetConfigRequest,
    principal?: AccessPrincipal,
  ): Promise<{ success: boolean }> => {
    // These settings have dedicated, validated procedures that also refresh
    // the caches depending on them: a raw write would bypass both.
    if (DEDICATED_SETTINGS.has(input.key)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${input.key} is managed from Administration (roles and single sign-on settings).`,
      });
    }
    const before = await configService.getConfig(input.key);
    await configService.setConfig(input.key, input.value, input.description);
    await recordSetting(principal, input.key, before ?? null, input.value);
    return { success: true };
  },

  getAuthProviders: async (): Promise<
    Array<{ id: string; name: string; enabled: boolean }>
  > => {
    return await configService.getAuthProviders();
  },
};
