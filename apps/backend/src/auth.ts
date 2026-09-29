import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { genericOAuth, GenericOAuthConfig } from "better-auth/plugins";

import { db } from "./db/index";
import { usersRepository } from "./db/repositories/users.repo";
import * as schema from "./db/schema";
import { accessService } from "./lib/access/access.service";
import { accessSettings } from "./lib/access/access-settings";
import { getAuthRequestStore } from "./lib/access/auth-request-context";
import { extractGroupsFromClaims } from "./lib/access/oidc-groups";
import { oidcSyncService } from "./lib/access/oidc-sync.service";
import { activityLog } from "./lib/activity/activity-log.service";
import { configService } from "./lib/config.service";
import logger from "./utils/logger";

// Provide default values for development
if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET environment variable is required");
}
if (!process.env.APP_URL) {
  throw new Error("APP_URL environment variable is required");
}

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const BETTER_AUTH_URL = process.env.APP_URL;

// Email/password endpoints, refused while basic authentication is disabled
// (SSO only). Trusted internal calls (bootstrap) are not affected.
const PASSWORD_AUTH_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/forgot-password",
  "/request-password-reset",
  "/reset-password",
]);

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
    // Called on every OIDC callback (sign-up and sign-in) with all ID token /
    // userinfo claims. Capture the groups claim for the database hooks below,
    // which apply role/group mappings once the user and session exist.
    mapProfileToUser: async (profile) => {
      const store = getAuthRequestStore();
      if (store) {
        const claimName = await accessSettings.getOidcGroupsClaim();
        store.oidc = {
          groups: extractGroupsFromClaims(
            profile as Record<string, unknown>,
            claimName,
          ),
          email: typeof profile.email === "string" ? profile.email : null,
        };
      }
      return {};
    },
  };

  oidcProviders.push(oidcConfig);
  logger.info(`✓ OIDC Provider configured: ${oidcConfig.providerId}`);
}

// Default trusted origins for development
const DEFAULT_TRUSTED_ORIGINS = [
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:12008",
  "http://127.0.0.1",
  "http://127.0.0.1:12008",
  "http://127.0.0.1:3000",
  "http://0.0.0.0",
  "http://0.0.0.0:3000",
  "http://0.0.0.0:12008",
];

// Parse extra trusted origins from environment variable (comma-separated)
const extraTrustedOrigins = process.env.EXTRA_TRUSTED_ORIGINS
  ? process.env.EXTRA_TRUSTED_ORIGINS.split(",")
      .map((origin: string) => origin.trim())
      .filter(Boolean)
  : [];

const trustedOrigins = [...DEFAULT_TRUSTED_ORIGINS, ...extraTrustedOrigins];

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
  trustedOrigins,
  plugins: [
    // Add generic OAuth plugin for OIDC support
    ...(oidcProviders.length > 0
      ? [genericOAuth({ config: oidcProviders })]
      : []),
  ],
  emailAndPassword: {
    enabled: true, // This will be dynamically controlled by middleware
    requireEmailVerification: false, // Set to true if you want email verification
  },
  account: {
    // Tokens returned by the identity provider are stored encrypted.
    encryptOAuthTokens: true,
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
    // Session lifetimes are env-var configurable so deployers can tune
    // how often users re-touch the gateway via SSO without rebuilding
    // the image. Defaults match the previous hardcoded values exactly,
    // so this is a strict superset — no behavior change for existing
    // installs that don't set the env vars.
    expiresIn: (() => {
      const raw = process.env.BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS;
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 60 * 24 * 7; // 7 days (default)
    })(),
    updateAge: (() => {
      const raw = process.env.BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS;
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 60 * 24; // 1 day (default — how often the session expiry is bumped on access)
    })(),
  },
  user: {
    additionalFields: {
      // Never user input: better-auth only links an SSO identity to an
      // existing local account whose email is verified, so a writable flag
      // let anyone pre-register a victim's email and capture their SSO login.
      emailVerified: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
      // RBAC base role. Never accepted from sign-up input: it is computed in
      // databaseHooks.user.create.before and managed by administrators.
      role: {
        type: "string",
        defaultValue: "viewer",
        input: false,
      },
    },
  },
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
    },
  },
  // Follows LOG_LEVEL ('all' | 'info' | 'errors-only' | 'none')
  logger: {
    disabled: process.env.LOG_LEVEL === "none",
    level:
      process.env.LOG_LEVEL === "all"
        ? "debug"
        : process.env.LOG_LEVEL === "info"
          ? "info"
          : "error",
  },
  // Failed OAuth/OIDC callbacks land on the login page (?error=<code>).
  onAPIError: {
    errorURL: `${BETTER_AUTH_URL}/login`,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          const store = getAuthRequestStore();
          const isOidcLogin = Boolean(store?.oidc);
          const refuse = async (reason: string) =>
            activityLog.record({
              actor: { kind: "system", label: "Sign-in" },
              action: "auth.sign_in_denied",
              outcome: "denied",
              target: { type: "user", id: null, label: user.email ?? null },
              details: { reason, method: isOidcLogin ? "sso" : "password" },
            });

          if (!store?.bypassSignupRestrictions) {
            // Check if signup is disabled based on the registration method
            const isSignupDisabled = await configService.isSignupDisabled();
            const isSsoSignupDisabled =
              await configService.isSsoSignupDisabled();

            // Determine if this is an SSO/OAuth registration by checking the request path
            // OAuth/SSO registrations typically come through callback endpoints
            const isSsoRegistration =
              isOidcLogin ||
              context?.path?.includes("/callback/") ||
              context?.path?.includes("/oauth/") ||
              context?.path?.includes("/oidc/");

            if (isSsoRegistration) {
              if (isSsoSignupDisabled) {
                await refuse("sso_signup_disabled");
                throw new APIError("FORBIDDEN", {
                  message: "sso_signup_disabled",
                });
              }
            } else {
              if (isSignupDisabled) {
                await refuse("signup_disabled");
                throw new Error("New user registration is currently disabled.");
              }
            }
          }

          if (
            store?.oidc &&
            !(await oidcSyncService.isLoginAllowed(store.oidc.groups))
          ) {
            await refuse("sso_no_matching_group");
            throw new APIError("FORBIDDEN", {
              message: "sso_no_matching_group",
            });
          }

          // Initial base role: the very first account and ADMIN_EMAILS are
          // administrators, everyone else gets the configured default role.
          // ADMIN_EMAILS only counts when the address is vouched for (SSO,
          // bootstrap / administrator, verified): anyone can self-register
          // with an address listed there but not registered yet.
          const email = String(user.email ?? "").toLowerCase();
          const isFirstUser = (await usersRepository.count()) === 0;
          const emailIsTrusted =
            isOidcLogin ||
            Boolean(store?.bypassSignupRestrictions) ||
            user.emailVerified === true;
          const role =
            isFirstUser ||
            (emailIsTrusted && accessSettings.getAdminEmails().includes(email))
              ? "admin"
              : await accessSettings.getDefaultRole();

          return { data: { ...user, role } };
        },
        after: async (user) => {
          const store = getAuthRequestStore();
          // Accounts created by administrators or the bootstrap are
          // recorded by the code that creates them.
          if (store?.bypassSignupRestrictions) return;
          const created = await usersRepository.findById(user.id);
          await activityLog.record(
            store?.oidc
              ? {
                  actor: { kind: "system", label: "SSO provisioning" },
                  action: "user.provisioned",
                  target: { type: "user", id: user.id, label: user.email },
                  details: { baseRole: created?.role ?? null },
                }
              : {
                  actor: { kind: "user", userId: user.id },
                  action: "user.created",
                  target: { type: "user", id: user.id, label: user.email },
                  details: { via: "sign-up", baseRole: created?.role ?? null },
                },
          );
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          const store = getAuthRequestStore();
          const user = await usersRepository.findById(session.userId);

          const deny = async (
            code: string,
            message: string,
          ): Promise<never> => {
            await activityLog.record({
              actor: { kind: "user", userId: session.userId },
              action: "auth.sign_in_denied",
              outcome: "denied",
              target: {
                type: "user",
                id: session.userId,
                label: user?.email ?? null,
              },
              details: {
                reason: code,
                method: store?.oidc ? "sso" : "password",
              },
            });
            // OIDC callbacks are browser navigations: redirect to the login
            // page instead of returning a JSON error.
            if (store?.oidc && context && "redirect" in context) {
              throw context.redirect(`${BETTER_AUTH_URL}/login?error=${code}`);
            }
            throw new APIError("FORBIDDEN", { message });
          };

          if (user?.disabled) {
            await deny(
              "account_disabled",
              "Your account has been disabled. Contact an administrator.",
            );
          }
          if (
            store?.oidc &&
            !(await oidcSyncService.isLoginAllowed(store.oidc.groups))
          ) {
            await deny(
              "sso_no_matching_group",
              "Your identity provider groups do not grant access to MetaMCP.",
            );
          }
          return { data: session };
        },
        after: async (session) => {
          const store = getAuthRequestStore();
          try {
            const user = await usersRepository.findById(session.userId);
            if (user && !store?.bypassSignupRestrictions) {
              await activityLog.record({
                actor: { kind: "user", userId: user.id },
                action: "auth.sign_in",
                target: { type: "user", id: user.id, label: user.email },
                details: { method: store?.oidc ? "sso" : "password" },
              });
            }
            if (
              user &&
              user.role !== "admin" &&
              (user.emailVerified || store?.oidc) &&
              accessSettings.getAdminEmails().includes(user.email.toLowerCase())
            ) {
              await usersRepository.setRole(user.id, "admin");
              await activityLog.record({
                actor: { kind: "system", label: "ADMIN_EMAILS" },
                action: "user.promoted",
                target: { type: "user", id: user.id, label: user.email },
                details: {
                  changes: { baseRole: { from: user.role, to: "admin" } },
                },
              });
            }
            if (store?.oidc && user) {
              await oidcSyncService.syncUser(user.id, store.oidc.groups);
            }
          } catch (error) {
            // Never block a login because of a sync failure.
            logger.error("Post-login RBAC sync failed:", error);
          } finally {
            accessService.invalidateUser(session.userId);
          }
        },
      },
    },
  },
  hooks: {
    // "Disable basic authentication" (SSO only) must hold on the API, not
    // only in the login form. (A top-level `middleware` option used for this
    // is not a better-auth option and was silently ignored.)
    before: createAuthMiddleware(async (ctx) => {
      if (
        PASSWORD_AUTH_PATHS.has(ctx.path) &&
        !getAuthRequestStore()?.bypassSignupRestrictions &&
        (await configService.isBasicAuthDisabled())
      ) {
        throw new APIError("FORBIDDEN", {
          message:
            "Basic email/password authentication is currently disabled. Please use SSO/OIDC authentication instead.",
        });
      }
    }),
  },
});

console.log("✓ Better Auth instance created successfully");
console.log(`✓ OIDC Providers configured: ${oidcProviders.length}`);

export type Session = typeof auth.$Infer.Session;
// Note: User type needs to be inferred from Session.user
export type User = typeof auth.$Infer.Session.user;
