import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getAppUrl } from "./env";

export const authClient = createAuthClient({
  baseURL: getAppUrl(),
  plugins: [genericOAuthClient()],
});

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
