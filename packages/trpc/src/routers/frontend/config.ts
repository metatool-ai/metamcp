import { SetConfigRequest, SetConfigRequestSchema } from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, publicProcedure, router } from "../../trpc";

export const createConfigRouter = (implementations: {
  getSignupDisabled: () => Promise<boolean>;
  setSignupDisabled: (input: {
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

    setSignupDisabled: protectedProcedure
      .input(z.object({ disabled: z.boolean() }))
      .mutation(async ({ input }) => {
        return await implementations.setSignupDisabled(input);
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
      .input(z.object({ timeout: z.number().min(1000).max(3000000) }))
      .mutation(async ({ input }) => {
        return await implementations.setMcpTimeout(input);
      }),

    getMcpMaxTotalTimeout: publicProcedure.query(async () => {
      return await implementations.getMcpMaxTotalTimeout();
    }),

    setMcpMaxTotalTimeout: protectedProcedure
      .input(z.object({ timeout: z.number().min(1000).max(3000000) }))
      .mutation(async ({ input }) => {
        return await implementations.setMcpMaxTotalTimeout(input);
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
  });
