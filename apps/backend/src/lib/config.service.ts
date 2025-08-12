import { ConfigKey, ConfigKeyEnum } from "@repo/zod-types";

import { configRepo } from "../db/repositories/config.repo";

export const configService = {
  async isSignupDisabled(): Promise<boolean> {
    const config = await configRepo.getConfig(
      ConfigKeyEnum.Enum.DISABLE_SIGNUP,
    );
    return config?.value === "true";
  },

  async setSignupDisabled(disabled: boolean): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.Enum.DISABLE_SIGNUP,
      disabled.toString(),
      "Whether new user signup is disabled",
    );
  },

  async getMcpResetTimeoutOnProgress(): Promise<boolean> {
    const config = await configRepo.getConfig(
      ConfigKeyEnum.Enum.MCP_RESET_TIMEOUT_ON_PROGRESS,
    );
    return config?.value === "true" || true;
  },

  async setMcpResetTimeoutOnProgress(enabled: boolean): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.Enum.MCP_RESET_TIMEOUT_ON_PROGRESS,
      enabled.toString(),
      "Whether to reset timeout on progress for MCP requests",
    );
  },

  async getMcpTimeout(): Promise<number> {
    const config = await configRepo.getConfig(ConfigKeyEnum.Enum.MCP_TIMEOUT);
    return config?.value ? parseInt(config.value, 10) : 60000;
  },

  async setMcpTimeout(timeout: number): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.Enum.MCP_TIMEOUT,
      timeout.toString(),
      "MCP request timeout in milliseconds",
    );
  },

  async getMcpMaxTotalTimeout(): Promise<number> {
    const config = await configRepo.getConfig(
      ConfigKeyEnum.Enum.MCP_MAX_TOTAL_TIMEOUT,
    );
    return config?.value ? parseInt(config.value, 10) : 60000;
  },

  async setMcpMaxTotalTimeout(timeout: number): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.Enum.MCP_MAX_TOTAL_TIMEOUT,
      timeout.toString(),
      "MCP maximum total timeout in milliseconds",
    );
  },

  async getConfig(key: ConfigKey): Promise<string | undefined> {
    const config = await configRepo.getConfig(key);
    return config?.value;
  },

  async setConfig(
    key: ConfigKey,
    value: string,
    description?: string,
  ): Promise<void> {
    await configRepo.setConfig(key, value, description);
  },

  async getAllConfigs(): Promise<
    Array<{ id: string; value: string; description?: string | null }>
  > {
    return await configRepo.getAllConfigs();
  },

  async getAuthProviders(): Promise<
    Array<{ id: string; name: string; enabled: boolean }>
  > {
    const providers = [];

    // Check if OIDC is configured
    const isOidcEnabled = !!(
      process.env.OIDC_CLIENT_ID &&
      process.env.OIDC_CLIENT_SECRET &&
      process.env.OIDC_DISCOVERY_URL
    );

    if (isOidcEnabled) {
      providers.push({
        id: "oidc",
        name: "OIDC",
        enabled: true,
      });
    }

    return providers;
  },
};
