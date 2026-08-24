import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getAppUrl } from "./env";

export const authClient = createAuthClient({
  baseURL: getAppUrl(),
  plugins: [genericOAuthClient()],
}) as ReturnType<typeof createAuthClient>;
