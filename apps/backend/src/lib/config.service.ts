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

  async isSsoSignupDisabled(): Promise<boolean> {
    const config = await configRepo.getConfig(
      ConfigKeyEnum.Enum.DISABLE_SSO_SIGNUP,
    );
    return config?.value === "true";
  },

  async setSsoSignupDisabled(disabled: boolean): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.Enum.DISABLE_SSO_SIGNUP,
      disabled.toString(),
      "Whether new user signup via SSO/OAuth is disabled",
    );
  },

  async isBasicAuthDisabled(): Promise<boolean> {
    const config = await configRepo.getConfig(
      ConfigKeyEnum.Enum.DISABLE_BASIC_AUTH,
    );
    return config?.value === "true";
  },

  async setBasicAuthDisabled(disabled: boolean): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.Enum.DISABLE_BASIC_AUTH,
      disabled.toString(),
      "Whether basic email/password authentication is disabled",
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
    return config?.value ? parseInt(config.value, 10) : 86400000;
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
    return config?.value ? parseInt(config.value, 10) : 86400000;
  },

  async setMcpMaxTotalTimeout(timeout: number): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.Enum.MCP_MAX_TOTAL_TIMEOUT,
      timeout.toString(),
      "MCP maximum total timeout in milliseconds",
    );
  },

  async getMcpMaxAttempts(): Promise<number> {
    const config = await configRepo.getConfig(
      ConfigKeyEnum.Enum.MCP_MAX_ATTEMPTS,
    );
    return config?.value ? parseInt(config.value, 10) : 1;
  },

  async setMcpMaxAttempts(maxAttempts: number): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.Enum.MCP_MAX_ATTEMPTS,
      maxAttempts.toString(),
      "Maximum number of crash attempts before marking MCP server as ERROR",
    );
  },

  async getSessionLifetime(): Promise<number | null> {
    const config = await configRepo.getConfig(
      ConfigKeyEnum.Enum.SESSION_LIFETIME,
    );
    if (!config?.value) {
      return null; // No session lifetime set - infinite sessions
    }
    const lifetime = parseInt(config.value, 10);
    return isNaN(lifetime) ? null : lifetime;
  },

  async setSessionLifetime(lifetime?: number | null): Promise<void> {
    if (lifetime === null || lifetime === undefined) {
      // Remove the config to indicate infinite session lifetime
      await configRepo.deleteConfig(ConfigKeyEnum.Enum.SESSION_LIFETIME);
    } else {
      await configRepo.setConfig(
        ConfigKeyEnum.Enum.SESSION_LIFETIME,
        lifetime.toString(),
        "Session lifetime in milliseconds before automatic cleanup",
      );
    }
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

  async getAllowedEmailDomains(): Promise<string[]> {
    const config = await configRepo.getConfig(
      ConfigKeyEnum.Enum.ALLOWED_EMAIL_DOMAINS,
    );
    if (!config?.value) {
      return []; // Empty array means all domains are allowed
    }
    return config.value.split(",").map((d) => d.trim()).filter(Boolean);
  },

  async setAllowedEmailDomains(domains: string[]): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.Enum.ALLOWED_EMAIL_DOMAINS,
      domains.join(","),
      "Comma-separated list of allowed email domains for registration and login",
    );
  },

  async isEmailDomainAllowed(email: string): Promise<boolean> {
    const allowedDomains = await this.getAllowedEmailDomains();

    // If no domains are configured, allow all
    if (allowedDomains.length === 0) {
      return true;
    }

    // Extract domain from email
    const emailDomain = email.split("@")[1]?.toLowerCase();
    if (!emailDomain) {
      return false;
    }

    // Check if domain is in the allowed list
    return allowedDomains.some(
      (domain) => domain.toLowerCase() === emailDomain,
    );
  },

  async getAllowedEmailDomainsString(): Promise<string> {
    const domains = await this.getAllowedEmailDomains();
    return domains.join(", ");
  },

  async setAllowedEmailDomainsString(domainsString: string): Promise<void> {
    const domains = domainsString
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    await this.setAllowedEmailDomains(domains);
  },

  // OAuth Client Domain Whitelist
  async getAllowedOAuthClientDomains(): Promise<string[]> {
    const config = await configRepo.getConfig(
      ConfigKeyEnum.Enum.ALLOWED_OAUTH_CLIENT_DOMAINS,
    );
    if (!config?.value) {
      return []; // Empty array means all domains are allowed
    }
    return config.value.split(",").map((d) => d.trim()).filter(Boolean);
  },

  async setAllowedOAuthClientDomains(domains: string[]): Promise<void> {
    await configRepo.setConfig(
      ConfigKeyEnum.Enum.ALLOWED_OAUTH_CLIENT_DOMAINS,
      domains.join(","),
      "Comma-separated list of allowed OAuth client redirect URI domains",
    );
  },

  async isOAuthClientDomainAllowed(redirectUri: string): Promise<boolean> {
    const allowedDomains = await this.getAllowedOAuthClientDomains();

    // If no domains are configured, allow all
    if (allowedDomains.length === 0) {
      return true;
    }

    try {
      // Extract domain from redirect URI
      const url = new URL(redirectUri);
      const domain = url.hostname.toLowerCase();

      // Check if domain is in the allowed list (exact match or subdomain)
      return allowedDomains.some((allowedDomain) => {
        const normalizedAllowed = allowedDomain.toLowerCase();
        // Exact match or subdomain match
        return (
          domain === normalizedAllowed ||
          domain.endsWith(`.${normalizedAllowed}`)
        );
      });
    } catch (error) {
      // Invalid URL
      return false;
    }
  },

  async getAllowedOAuthClientDomainsString(): Promise<string> {
    const domains = await this.getAllowedOAuthClientDomains();
    return domains.join(", ");
  },

  async setAllowedOAuthClientDomainsString(
    domainsString: string,
  ): Promise<void> {
    const domains = domainsString
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    await this.setAllowedOAuthClientDomains(domains);
  },
};
