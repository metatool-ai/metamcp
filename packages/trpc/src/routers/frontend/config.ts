import {
  type AccessPrincipal,
  SetConfigRequest,
  SetConfigRequestSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { adminProcedure, publicProcedure, router } from "../../trpc";

/** Settings setters receive the administrator, for the activity log. */
type Setter<I> = (
  input: I,
  principal?: AccessPrincipal,
) => Promise<{ success: boolean }>;

export const createConfigRouter = (implementations: {
  getSignupDisabled: () => Promise<boolean>;
  setSignupDisabled: Setter<{ disabled: boolean }>;
  getSsoSignupDisabled: () => Promise<boolean>;
  setSsoSignupDisabled: Setter<{ disabled: boolean }>;
  getBasicAuthDisabled: () => Promise<boolean>;
  setBasicAuthDisabled: Setter<{ disabled: boolean }>;
  getMcpResetTimeoutOnProgress: () => Promise<boolean>;
  setMcpResetTimeoutOnProgress: Setter<{ enabled: boolean }>;
  getMcpTimeout: () => Promise<number>;
  setMcpTimeout: Setter<{ timeout: number }>;
  getMcpMaxTotalTimeout: () => Promise<number>;
  setMcpMaxTotalTimeout: Setter<{ timeout: number }>;
  getMcpMaxAttempts: () => Promise<number>;
  setMcpMaxAttempts: Setter<{ maxAttempts: number }>;
  getSessionLifetime: () => Promise<number | null>;
  setSessionLifetime: Setter<{ lifetime?: number | null }>;
  getAllConfigs: () => Promise<
    Array<{ id: string; value: string; description?: string | null }>
  >;
  setConfig: Setter<SetConfigRequest>;
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
      .mutation(async ({ input, ctx }) => {
        return await implementations.setSignupDisabled(input, ctx.principal);
      }),

    getSsoSignupDisabled: publicProcedure.query(async () => {
      return await implementations.getSsoSignupDisabled();
    }),

    setSsoSignupDisabled: adminProcedure
      .input(z.object({ disabled: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        return await implementations.setSsoSignupDisabled(input, ctx.principal);
      }),

    getBasicAuthDisabled: publicProcedure.query(async () => {
      return await implementations.getBasicAuthDisabled();
    }),

    setBasicAuthDisabled: adminProcedure
      .input(z.object({ disabled: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        return await implementations.setBasicAuthDisabled(input, ctx.principal);
      }),

    getMcpResetTimeoutOnProgress: publicProcedure.query(async () => {
      return await implementations.getMcpResetTimeoutOnProgress();
    }),

    setMcpResetTimeoutOnProgress: adminProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        return await implementations.setMcpResetTimeoutOnProgress(
          input,
          ctx.principal,
        );
      }),

    getMcpTimeout: publicProcedure.query(async () => {
      return await implementations.getMcpTimeout();
    }),

    setMcpTimeout: adminProcedure
      .input(z.object({ timeout: z.number().min(1000).max(86400000) }))
      .mutation(async ({ input, ctx }) => {
        return await implementations.setMcpTimeout(input, ctx.principal);
      }),

    getMcpMaxTotalTimeout: publicProcedure.query(async () => {
      return await implementations.getMcpMaxTotalTimeout();
    }),

    setMcpMaxTotalTimeout: adminProcedure
      .input(z.object({ timeout: z.number().min(1000).max(86400000) }))
      .mutation(async ({ input, ctx }) => {
        return await implementations.setMcpMaxTotalTimeout(
          input,
          ctx.principal,
        );
      }),

    getMcpMaxAttempts: publicProcedure.query(async () => {
      return await implementations.getMcpMaxAttempts();
    }),

    setMcpMaxAttempts: adminProcedure
      .input(z.object({ maxAttempts: z.number().min(1).max(10) }))
      .mutation(async ({ input, ctx }) => {
        return await implementations.setMcpMaxAttempts(input, ctx.principal);
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
      .mutation(async ({ input, ctx }) => {
        return await implementations.setSessionLifetime(input, ctx.principal);
      }),

    getAllConfigs: adminProcedure.query(async () => {
      return await implementations.getAllConfigs();
    }),

    setConfig: adminProcedure
      .input(SetConfigRequestSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.setConfig(input, ctx.principal);
      }),

    getAuthProviders: publicProcedure.query(async () => {
      return await implementations.getAuthProviders();
    }),
  });
