import { createAuthClient } from "better-auth/react";

import { getAppUrl } from "./env";

// Generic OAuth/OIDC providers are signed in through `signIn.social` in
// better-auth >= 1.7, so no client plugin is needed.
export const authClient = createAuthClient({
  baseURL: getAppUrl(),
});
