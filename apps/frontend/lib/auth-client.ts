"use client";

import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getAppUrl } from "./env";

let authClientInstance: ReturnType<typeof createAuthClient> | null = null;

export const getAuthClient = (): ReturnType<typeof createAuthClient> => {
  if (typeof window === "undefined") {
    // Return a mock object during SSR to prevent errors
    return {} as ReturnType<typeof createAuthClient>;
  }

  if (!authClientInstance) {
    authClientInstance = createAuthClient({
      baseURL: `${getAppUrl()}/api/auth`,
      plugins: [genericOAuthClient()],
    });
  }

  return authClientInstance;
};

// For backward compatibility
export const authClient: ReturnType<typeof createAuthClient> = getAuthClient();
