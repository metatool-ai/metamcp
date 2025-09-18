import { SetConfigRequest } from "@repo/zod-types";

import { configService } from "../lib/config.service";

export const configImplementations = {
  getSignupDisabled: async (): Promise<boolean> => {
    return await configService.isSignupDisabled();
  },

  setSignupDisabled: async (input: {
    disabled: boolean;
  }): Promise<{ success: boolean }> => {
    await configService.setSignupDisabled(input.disabled);
    return { success: true };
  },

  getSsoSignupDisabled: async (): Promise<boolean> => {
    return await configService.isSsoSignupDisabled();
  },

  setSsoSignupDisabled: async (input: {
    disabled: boolean;
  }): Promise<{ success: boolean }> => {
    await configService.setSsoSignupDisabled(input.disabled);
    return { success: true };
  },

  getMcpResetTimeoutOnProgress: async (): Promise<boolean> => {
    return await configService.getMcpResetTimeoutOnProgress();
  },

  setMcpResetTimeoutOnProgress: async (input: {
    enabled: boolean;
  }): Promise<{ success: boolean }> => {
    await configService.setMcpResetTimeoutOnProgress(input.enabled);
    return { success: true };
  },

  getMcpTimeout: async (): Promise<number> => {
    return await configService.getMcpTimeout();
  },

  setMcpTimeout: async (input: {
    timeout: number;
  }): Promise<{ success: boolean }> => {
    await configService.setMcpTimeout(input.timeout);
    return { success: true };
  },

  getMcpMaxTotalTimeout: async (): Promise<number> => {
    return await configService.getMcpMaxTotalTimeout();
  },

  setMcpMaxTotalTimeout: async (input: {
    timeout: number;
  }): Promise<{ success: boolean }> => {
    await configService.setMcpMaxTotalTimeout(input.timeout);
    return { success: true };
  },

  getMcpMaxAttempts: async (): Promise<number> => {
    return await configService.getMcpMaxAttempts();
  },

  setMcpMaxAttempts: async (input: {
    maxAttempts: number;
  }): Promise<{ success: boolean }> => {
    await configService.setMcpMaxAttempts(input.maxAttempts);
    return { success: true };
  },

  getAllConfigs: async (): Promise<
    Array<{ id: string; value: string; description?: string | null }>
  > => {
    return await configService.getAllConfigs();
  },

  setConfig: async (input: SetConfigRequest): Promise<{ success: boolean }> => {
    await configService.setConfig(input.key, input.value, input.description);
    return { success: true };
  },

  getAuthProviders: async (): Promise<
    Array<{ id: string; name: string; enabled: boolean }>
  > => {
    return await configService.getAuthProviders();
  },
};
