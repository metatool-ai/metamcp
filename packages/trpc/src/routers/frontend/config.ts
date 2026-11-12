import { SetConfigRequest, SetConfigRequestSchema } from "@repo/zod-types";
import { z } from "zod";

import { adminProcedure, publicProcedure, router } from "../../trpc";

// Global settings: every setter (and the raw getAllConfigs/setConfig) is
// restricted to administrators (METAMCP_ADMIN_EMAILS; everyone when unset).
// The individual getters stay public because the login/signup UI reads them
// before a session exists.
export const createConfigRouter = (implementations: {
  getSignupDisabled: () => Promise<boolean>;
  setSignupDisabled: (input: {
    disabled: boolean;
  }) => Promise<{ success: boolean }>;
  getSsoSignupDisabled: () => Promise<boolean>;
  setSsoSignupDisabled: (input: {
    disabled: boolean;
  }) => Promise<{ success: boolean }>;
  getBasicAuthDisabled: () => Promise<boolean>;
  setBasicAuthDisabled: (input: {
    disabled: boolean;
  }) => Promise<{ success: boolean }>;
  getMcpResetTimeoutOnProgress: () => Promise<boolean>;
  setMcpResetTimeoutOnProgress: (input: {
    enabled: boolean;
  }) => Promise<{ success: boolean }>;
  getMcpTimeout: () => Promise<number>;
  setMcpTimeout: (input: { timeout: number }) => Promise<{ success: boolean }>;
  getMcpMaxTotalTimeout: () => Promise<number>;
  setMcpMaxTotalTimeout: (input: {
    timeout: number;
  }) => Promise<{ success: boolean }>;
  getMcpMaxAttempts: () => Promise<number>;
  setMcpMaxAttempts: (input: {
    maxAttempts: number;
  }) => Promise<{ success: boolean }>;
  getSessionLifetime: () => Promise<number | null>;
  setSessionLifetime: (input: {
    lifetime?: number | null;
  }) => Promise<{ success: boolean }>;
  getAllConfigs: () => Promise<
    Array<{ id: string; value: string; description?: string | null }>
  >;
  setConfig: (input: SetConfigRequest) => Promise<{ success: boolean }>;
  getAuthProviders: () => Promise<
    Array<{ id: string; name: string; enabled: boolean }>
  >;
}) =>
  router({
    getSignupDisabled: publicProcedure.query(async () => {
      return await implementations.getSignupDisabled();
    }),

    setSignupDisabled: adminProcedure
      .input(z.object({ disabled: z.boolean() }))
      .mutation(async ({ input }) => {
        return await implementations.setSignupDisabled(input);
      }),

    getSsoSignupDisabled: publicProcedure.query(async () => {
      return await implementations.getSsoSignupDisabled();
    }),

    setSsoSignupDisabled: adminProcedure
      .input(z.object({ disabled: z.boolean() }))
      .mutation(async ({ input }) => {
        return await implementations.setSsoSignupDisabled(input);
      }),

    getBasicAuthDisabled: publicProcedure.query(async () => {
      return await implementations.getBasicAuthDisabled();
    }),

    setBasicAuthDisabled: adminProcedure
      .input(z.object({ disabled: z.boolean() }))
      .mutation(async ({ input }) => {
        return await implementations.setBasicAuthDisabled(input);
      }),

    getMcpResetTimeoutOnProgress: publicProcedure.query(async () => {
      return await implementations.getMcpResetTimeoutOnProgress();
    }),

    setMcpResetTimeoutOnProgress: adminProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        return await implementations.setMcpResetTimeoutOnProgress(input);
      }),

    getMcpTimeout: publicProcedure.query(async () => {
      return await implementations.getMcpTimeout();
    }),

    setMcpTimeout: adminProcedure
      .input(z.object({ timeout: z.number().min(1000).max(86400000) }))
      .mutation(async ({ input }) => {
        return await implementations.setMcpTimeout(input);
      }),

    getMcpMaxTotalTimeout: publicProcedure.query(async () => {
      return await implementations.getMcpMaxTotalTimeout();
    }),

    setMcpMaxTotalTimeout: adminProcedure
      .input(z.object({ timeout: z.number().min(1000).max(86400000) }))
      .mutation(async ({ input }) => {
        return await implementations.setMcpMaxTotalTimeout(input);
      }),

    getMcpMaxAttempts: publicProcedure.query(async () => {
      return await implementations.getMcpMaxAttempts();
    }),

    setMcpMaxAttempts: adminProcedure
      .input(z.object({ maxAttempts: z.number().min(1).max(10) }))
      .mutation(async ({ input }) => {
        return await implementations.setMcpMaxAttempts(input);
      }),

    getSessionLifetime: publicProcedure.query(async () => {
      return await implementations.getSessionLifetime();
    }),

    setSessionLifetime: adminProcedure
      .input(
        z.object({
          lifetime: z.number().min(300000).max(86400000).nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        return await implementations.setSessionLifetime(input);
      }),

    getAllConfigs: adminProcedure.query(async () => {
      return await implementations.getAllConfigs();
    }),

    setConfig: adminProcedure
      .input(SetConfigRequestSchema)
      .mutation(async ({ input }) => {
        return await implementations.setConfig(input);
      }),

    getAuthProviders: publicProcedure.query(async () => {
      return await implementations.getAuthProviders();
    }),
  });
