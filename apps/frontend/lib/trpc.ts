import type { AppRouter } from "@repo/trpc";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { type CreateTRPCReact, createTRPCReact } from "@trpc/react-query";

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

// Get the base URL for tRPC
function getTrpcUrl() {
  // Server-side: use internal URL or fallback to localhost
  if (typeof window === "undefined") {
    // Check if APP_URL is set in environment
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
    if (appUrl) {
      return `${appUrl}/trpc`;
    }
    // Fallback to localhost
    return `http://localhost:${process.env.PORT || 3000}/trpc`;
  }
  // Client-side: use relative URL
  return "/trpc";
}

export const vanillaTrpcClient = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: getTrpcUrl(),
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
