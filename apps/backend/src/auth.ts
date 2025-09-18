import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, GenericOAuthConfig } from "better-auth/plugins";

import { db } from "./db/index";
import * as schema from "./db/schema";
import { configService } from "./lib/config.service";

// Provide default values for development
if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET environment variable is required");
}
if (!process.env.APP_URL) {
  throw new Error("APP_URL environment variable is required");
}

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const BETTER_AUTH_URL = process.env.APP_URL;

// OIDC Provider configuration - optional, only if environment variables are provided
const oidcProviders: GenericOAuthConfig[] = [];

// Add OIDC provider if configured
if (process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET) {
  const oidcConfig: GenericOAuthConfig = {
    providerId: process.env.OIDC_PROVIDER_ID || "oidc",
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    scopes: (process.env.OIDC_SCOPES || "openid email profile").split(" "),
    pkce: process.env.OIDC_PKCE !== "false", // Enable PKCE by default for security
    discoveryUrl: process.env.OIDC_DISCOVERY_URL,
    authorizationUrl: process.env.OIDC_AUTHORIZATION_URL, //this is required due to a bug in better-auth: https://github.com/better-auth/better-auth/issues/3278
  };

  oidcProviders.push(oidcConfig);
  console.log(`✓ OIDC Provider configured: ${oidcConfig.providerId}`);
}

export const auth = betterAuth({
  secret: BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.usersTable,
      session: schema.sessionsTable,
      account: schema.accountsTable,
      verification: schema.verificationsTable,
    },
  }),
  trustedOrigins: [
    "http://localhost", // Added this line to fix the "Invalid origin" error
    "http://localhost:3000",
    "http://localhost:12008",
    "http://127.0.0.1", // Also added this for good measure
    "http://127.0.0.1:12008",
    "http://127.0.0.1:3000",
    "http://0.0.0.0",
    "http://0.0.0.0:3000",
    "http://0.0.0.0:12008",
  ],
  plugins: [
    // Add generic OAuth plugin for OIDC support
    ...(oidcProviders.length > 0
      ? [genericOAuth({ config: oidcProviders })]
      : []),
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true if you want email verification
  },
  account: {
    accountLinking: {
      enabled: true,
      // Allow linking accounts with the same email address
      allowDifferentEmails: false,
      // Trusted providers for automatic linking (add your OIDC provider here)
      trustedProviders: oidcProviders.map((p) => p.providerId),
      // Allow automatic linking for same email addresses
      allowSameEmail: true,
      // Require email verification for account linking
      requireEmailVerification: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day (how often to update the session)
  },
  user: {
    additionalFields: {
      emailVerified: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
    },
  },
  logger: {
    level: "debug", // Enable debug logging
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          // Check if signup is disabled based on the registration method
          const isSignupDisabled = await configService.isSignupDisabled();
          const isSsoSignupDisabled = await configService.isSsoSignupDisabled();

          // Determine if this is an SSO/OAuth registration by checking the request path
          // OAuth/SSO registrations typically come through callback endpoints
          const isSsoRegistration =
            context?.path?.includes("/callback/") ||
            context?.path?.includes("/oauth/") ||
            context?.path?.includes("/oidc/");

          if (isSsoRegistration) {
            if (isSsoSignupDisabled) {
              throw new Error(
                "New user registration via SSO/OAuth is currently disabled.",
              );
            }
          } else {
            if (isSignupDisabled) {
              throw new Error("New user registration is currently disabled.");
            }
          }

          return { data: user };
        },
      },
    },
  },
});

console.log("✓ Better Auth instance created successfully");
console.log(`✓ OIDC Providers configured: ${oidcProviders.length}`);

export type Session = typeof auth.$Infer.Session;
// Note: User type needs to be inferred from Session.user
export type User = typeof auth.$Infer.Session.user;
