import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { InferSessionFromClient } from "better-auth/client";

import { getAppUrl } from "./env";

const client = createAuthClient({
  baseURL: getAppUrl(),
  plugins: [genericOAuthClient()],
});

export const authClient: typeof client = client;

// Extend the session type to include isAdmin field
export type ExtendedUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  isAdmin: boolean;
};

export type ExtendedSession = {
  user: ExtendedUser;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    token: string;
    [key: string]: any;
  };
};
