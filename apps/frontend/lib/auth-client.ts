import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`, // Use absolute URL with window origin
  plugins: [genericOAuthClient()],
}) as ReturnType<typeof createAuthClient>;
