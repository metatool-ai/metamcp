import { SetConfigRequest, SetConfigRequestSchema } from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, publicProcedure, router } from "../../trpc";

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
  getAuthConfig: () => Promise<{
    isSignupDisabled: boolean;
    isBasicAuthDisabled: boolean;
    isOidcEnabled: boolean;
  }>;
  getAllowedEmailDomains: () => Promise<string>;
  setAllowedEmailDomains: (input: {
    domains: string;
  }) => Promise<{ success: boolean }>;
  getAllowedOAuthClientDomains: () => Promise<string>;
  setAllowedOAuthClientDomains: (input: {
    domains: string;
  }) => Promise<{ success: boolean }>;
}) =>
  router({
    getSignupDisabled: publicProcedure.query(async () => {
      return await implementations.getSignupDisabled();
    }),

    setSignupDisabled: protectedProcedure
      .input(z.object({ disabled: z.boolean() }))
      .mutation(async ({ input }) => {
        return await implementations.setSignupDisabled(input);
      }),

    getSsoSignupDisabled: publicProcedure.query(async () => {
      return await implementations.getSsoSignupDisabled();
    }),

    setSsoSignupDisabled: protectedProcedure
      .input(z.object({ disabled: z.boolean() }))
      .mutation(async ({ input }) => {
        return await implementations.setSsoSignupDisabled(input);
      }),

    getBasicAuthDisabled: publicProcedure.query(async () => {
      return await implementations.getBasicAuthDisabled();
    }),

    setBasicAuthDisabled: protectedProcedure
      .input(z.object({ disabled: z.boolean() }))
      .mutation(async ({ input }) => {
        return await implementations.setBasicAuthDisabled(input);
      }),

    getMcpResetTimeoutOnProgress: publicProcedure.query(async () => {
      return await implementations.getMcpResetTimeoutOnProgress();
    }),

    setMcpResetTimeoutOnProgress: protectedProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        return await implementations.setMcpResetTimeoutOnProgress(input);
      }),

    getMcpTimeout: publicProcedure.query(async () => {
      return await implementations.getMcpTimeout();
    }),

    setMcpTimeout: protectedProcedure
      .input(z.object({ timeout: z.number().min(1000).max(86400000) }))
      .mutation(async ({ input }) => {
        return await implementations.setMcpTimeout(input);
      }),

    getMcpMaxTotalTimeout: publicProcedure.query(async () => {
      return await implementations.getMcpMaxTotalTimeout();
    }),

    setMcpMaxTotalTimeout: protectedProcedure
      .input(z.object({ timeout: z.number().min(1000).max(86400000) }))
      .mutation(async ({ input }) => {
        return await implementations.setMcpMaxTotalTimeout(input);
      }),

    getMcpMaxAttempts: publicProcedure.query(async () => {
      return await implementations.getMcpMaxAttempts();
    }),

    setMcpMaxAttempts: protectedProcedure
      .input(z.object({ maxAttempts: z.number().min(1).max(10) }))
      .mutation(async ({ input }) => {
        return await implementations.setMcpMaxAttempts(input);
      }),

    getSessionLifetime: publicProcedure.query(async () => {
      return await implementations.getSessionLifetime();
    }),

    setSessionLifetime: protectedProcedure
      .input(z.object({ lifetime: z.number().min(300000).max(86400000).nullable().optional() }))
      .mutation(async ({ input }) => {
        return await implementations.setSessionLifetime(input);
      }),

    getAllConfigs: protectedProcedure.query(async () => {
      return await implementations.getAllConfigs();
    }),

    setConfig: protectedProcedure
      .input(SetConfigRequestSchema)
      .mutation(async ({ input }) => {
        return await implementations.setConfig(input);
      }),

    getAuthProviders: publicProcedure.query(async () => {
      return await implementations.getAuthProviders();
    }),

    getAuthConfig: publicProcedure.query(async () => {
      return await implementations.getAuthConfig();
    }),

    getAllowedEmailDomains: protectedProcedure.query(async () => {
      return await implementations.getAllowedEmailDomains();
    }),

    setAllowedEmailDomains: protectedProcedure
      .input(z.object({ domains: z.string() }))
      .mutation(async ({ input }) => {
        return await implementations.setAllowedEmailDomains(input);
      }),

    getAllowedOAuthClientDomains: protectedProcedure.query(async () => {
      return await implementations.getAllowedOAuthClientDomains();
    }),

    setAllowedOAuthClientDomains: protectedProcedure
      .input(z.object({ domains: z.string() }))
      .mutation(async ({ input }) => {
        return await implementations.setAllowedOAuthClientDomains(input);
      }),
  });
