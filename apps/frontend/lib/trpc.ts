import { createAppRouter } from "@repo/trpc";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { type CreateTRPCReact, createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";

// Create a type that matches the backend router
type AppRouter = ReturnType<typeof createAppRouter>;

// Procedure outputs as received by the browser (dates arrive as strings).
export type RouterOutputs = inferRouterOutputs<AppRouter>;
/** An API key as listed (dates arrive as strings). */
export type ApiKeyRow =
  RouterOutputs["frontend"]["apiKeys"]["list"]["apiKeys"][number];
export type AdminUserRow =
  RouterOutputs["frontend"]["admin"]["users"]["list"]["users"][number];
export type GroupRow =
  RouterOutputs["frontend"]["admin"]["groups"]["list"][number];
export type GroupDetailRow = NonNullable<
  RouterOutputs["frontend"]["admin"]["groups"]["get"]
>;

// Create the tRPC client
export const trpc: CreateTRPCReact<AppRouter, unknown> =
  createTRPCReact<AppRouter>();

// Create tRPC client with HTTP link configured for better-auth
export const reactTrpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/trpc",
      // Include credentials (cookies) in requests for better-auth
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include",
        });
      },
    }),
  ],
});

export const vanillaTrpcClient = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/trpc",
      // Include credentials (cookies) in requests for better-auth
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include",
        });
      },
    }),
  ],
});
