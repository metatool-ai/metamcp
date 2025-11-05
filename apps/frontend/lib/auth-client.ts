import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getAppUrl } from "./env";

// Create auth client with extended user fields
// The backend defines additionalFields with isAdmin, but the client needs
// to know about it for type safety
export const authClient = createAuthClient({
  baseURL: getAppUrl(),
  plugins: [genericOAuthClient()],
});

// Define the user type that matches backend's additionalFields
export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  isAdmin: boolean; // From additionalFields in backend
}

// Type guard to check if session has user with isAdmin
export function isAuthenticatedUser(user: any): user is User {
  return user && typeof user.id === 'string' && typeof user.isAdmin === 'boolean';
}
