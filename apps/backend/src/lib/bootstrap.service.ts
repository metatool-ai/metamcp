import { ConfigKeyEnum } from "@repo/zod-types";
import { and, eq, isNull, ne } from "drizzle-orm";
import crypto from "node:crypto";

import { auth } from "../auth";
import { db } from "../db";
import {
  accountsTable,
  apiKeysTable,
  configTable,
  endpointsTable,
  namespacesTable,
  usersTable,
} from "../db/schema";

/**
 * Environment-based bootstrap for MetaMCP.
 * - No new dependencies
 * - Use Better Auth sign-up endpoint for password hashing
 * - Optional hard-fail on startup (warn + continue by default)
 */

type EnvConfig = {
  // Default user
  defaultUserEmail?: string;
  defaultUserPassword?: string;
  defaultUserName: string;
  defaultUserCreateApiKeys: boolean;
  deleteOtherUsers: boolean;

  // User lifecycle / safety
  recreateDefaultUser: boolean; // delete + recreate user to apply password
  preserveApiKeysOnRecreate: boolean; // keep user-scoped keys across recreate
  warnOnPasswordChange: boolean; // compare fingerprint + warn if changed
  bootstrapOnlyOnFirstRun: boolean; // one-time bootstrap mode

  // Registration controls
  disableUiRegistration: boolean;
  disableSsoRegistration: boolean;

  // Namespace
  defaultNamespaceName?: string;
  defaultNamespaceDescription?: string;
  defaultNamespaceIsPublic: boolean;
  defaultNamespaceUpdateIfExists: boolean;

  // Endpoint
  defaultEndpointName?: string;
  defaultEndpointDescription?: string;
  defaultEndpointEnableApiKeyAuth: boolean;
  defaultEndpointUseQueryParamAuth: boolean;
  defaultEndpointEnableOauth: boolean;
  defaultEndpointIsPublic: boolean;
  defaultEndpointUpdateIfExists: boolean;
};

const BOOTSTRAP_COMPLETE_KEY = "BOOTSTRAP_COMPLETE";
const BOOTSTRAP_USER_PASSWORD_FP_KEY = "BOOTSTRAP_USER_PASSWORD_FINGERPRINT";

function parseBool(value: string | undefined, def: boolean): boolean {
  if (value === undefined) return def;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return def;
}

function nonEmpty(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function generateApiKey(): string {
  return `sk_mt_${crypto.randomBytes(32).toString("hex")}`; // 64 hex chars
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 14) return `${key.slice(0, 6)}…`;
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function parseEnvConfig(): EnvConfig {
  return {
    // Default user
    defaultUserEmail: nonEmpty(process.env.BOOTSTRAP_USER_EMAIL),
    defaultUserPassword: nonEmpty(process.env.BOOTSTRAP_USER_PASSWORD),
    defaultUserName: nonEmpty(process.env.BOOTSTRAP_USER_NAME) ?? "Administrator",
    defaultUserCreateApiKeys: parseBool(
      process.env.BOOTSTRAP_CREATE_API_KEYS,
      true,
    ),
    deleteOtherUsers: parseBool(process.env.BOOTSTRAP_DELETE_OTHER_USERS, false),

    recreateDefaultUser: parseBool(process.env.BOOTSTRAP_RECREATE_USER, false),
    preserveApiKeysOnRecreate: parseBool(
      process.env.BOOTSTRAP_PRESERVE_API_KEYS,
      true,
    ),
    warnOnPasswordChange: parseBool(process.env.BOOTSTRAP_WARN_PASSWORD_CHANGE, true),
    bootstrapOnlyOnFirstRun: parseBool(
      process.env.BOOTSTRAP_ONLY_FIRST_RUN,
      false,
    ),

    // Registration controls
    disableUiRegistration: parseBool(process.env.BOOTSTRAP_DISABLE_REGISTRATION_UI, false),
    disableSsoRegistration: parseBool(
      process.env.BOOTSTRAP_DISABLE_REGISTRATION_SSO,
      false,
    ),

    // Namespace
    defaultNamespaceName: nonEmpty(process.env.BOOTSTRAP_NAMESPACE),
    defaultNamespaceDescription: nonEmpty(
      process.env.BOOTSTRAP_NAMESPACE_DESCRIPTION,
    ),
    defaultNamespaceIsPublic: parseBool(
      process.env.BOOTSTRAP_NAMESPACE_IS_PUBLIC,
      false,
    ),
    defaultNamespaceUpdateIfExists: parseBool(
      process.env.BOOTSTRAP_NAMESPACE_UPDATE,
      true,
    ),

    // Endpoint
    defaultEndpointName: nonEmpty(process.env.BOOTSTRAP_ENDPOINT),
    defaultEndpointDescription: nonEmpty(
      process.env.BOOTSTRAP_ENDPOINT_DESCRIPTION,
    ),
    defaultEndpointEnableApiKeyAuth: parseBool(
      process.env.BOOTSTRAP_ENDPOINT_ENABLE_API_KEY,
      true,
    ),
    defaultEndpointUseQueryParamAuth: parseBool(
      process.env.BOOTSTRAP_ENDPOINT_USE_QUERY_PARAM,
      false,
    ),
    defaultEndpointEnableOauth: parseBool(
      process.env.BOOTSTRAP_ENDPOINT_ENABLE_OAUTH,
      false,
    ),
    defaultEndpointIsPublic: parseBool(
      process.env.BOOTSTRAP_ENDPOINT_IS_PUBLIC,
      true,
    ),
    defaultEndpointUpdateIfExists: parseBool(
      process.env.BOOTSTRAP_ENDPOINT_UPDATE,
      true,
    ),
  };
}

async function upsertConfig(key: string, value: string, description?: string) {
  await db
    .insert(configTable)
    .values({
      id: key,
      value,
      description,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [configTable.id],
      set: { value, description, updated_at: new Date() },
    });
}

async function getConfigValue(key: string): Promise<string | null> {
  const row = await db.query.configTable.findFirst({
    where: eq(configTable.id, key),
  });
  return row?.value ?? null;
}

async function shouldSkipBootstrap(config: EnvConfig): Promise<boolean> {
  if (!config.bootstrapOnlyOnFirstRun) return false;

  try {
    const v = await getConfigValue(BOOTSTRAP_COMPLETE_KEY);
    if (v === "true") {
      console.log(
        "✓ Bootstrap already completed; BOOTSTRAP_ONLY_FIRST_RUN=true (skipping one-time bootstrap steps)",
      );
      return true;
    }
  } catch (err) {
    console.warn(
      "⚠️ Failed to read BOOTSTRAP_COMPLETE marker; proceeding with bootstrap.",
      err,
    );
  }

  return false;
}

async function markBootstrapComplete(): Promise<void> {
  try {
    await upsertConfig(
      BOOTSTRAP_COMPLETE_KEY,
      "true",
      "One-time bootstrap completion marker",
    );
  } catch (err) {
    console.warn("⚠️ Failed to write BOOTSTRAP_COMPLETE marker:", err);
  }
}

async function warnIfPasswordChanged(
  config: EnvConfig,
  hasExistingUser: boolean,
): Promise<void> {
  const email = config.defaultUserEmail;
  const password = config.defaultUserPassword;
  if (!config.warnOnPasswordChange) return;
  if (!email || !password) return;
  if (!hasExistingUser) return;

  try {
    const currentFp = sha256Hex(password);
    const previousFp = await getConfigValue(BOOTSTRAP_USER_PASSWORD_FP_KEY);

    if (previousFp && previousFp !== currentFp && !config.recreateDefaultUser) {
      console.warn(
        "⚠️ BOOTSTRAP_USER_PASSWORD appears to have changed since last applied.",
      );
      console.warn(
        "⚠️ BOOTSTRAP_RECREATE_USER=false so the existing user's password will NOT be updated.",
      );
      console.warn(
        "⚠️ To force the environment password to apply, set BOOTSTRAP_RECREATE_USER=true.",
      );
    }
  } catch (err) {
    console.warn("⚠️ Failed password-change detection (ignored):", err);
  }
}

async function recordPasswordFingerprint(password: string): Promise<void> {
  try {
    await upsertConfig(
      BOOTSTRAP_USER_PASSWORD_FP_KEY,
      sha256Hex(password),
      "Fingerprint of last-applied BOOTSTRAP_USER_PASSWORD",
    );
  } catch (err) {
    console.warn("⚠️ Failed to store password fingerprint:", err);
  }
}

/**
 * Ensure default user exists.
 *
 * - If user exists:
 *   - Warn on password change (if enabled)
 *   - Optionally recreate user if BOOTSTRAP_RECREATE_USER=true
 * - If user does not exist:
 *   - Create via Better Auth signup API
 *
 * IMPORTANT: Password rotation is only possible via delete+recreate (Better Auth
 * sign-up will not overwrite an existing email’s credential).
 */
async function ensureDefaultUser(
  config: EnvConfig,
): Promise<{
  userId?: string;
  recreated: boolean;
}> {
  const email = config.defaultUserEmail;
  const password = config.defaultUserPassword;
  if (!email || !password) {
    console.warn(
      "⚠️ BOOTSTRAP_USER_EMAIL/BOOTSTRAP_USER_PASSWORD not set; skipping default user initialization.",
    );
    return { recreated: false };
  }

  console.log(`🔧 Initializing default user: ${email}`);

  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, email),
  });

  await warnIfPasswordChanged(config, !!existing);

  let preservedUserApiKeys:
    | { name: string; key: string; is_active: boolean }[]
    | undefined;

  let recreated = false;

  if (existing && config.recreateDefaultUser) {
    recreated = true;
    console.warn(
      "⚠️ BOOTSTRAP_RECREATE_USER=true — deleting existing user to reapply password via Better Auth",
    );

    if (config.preserveApiKeysOnRecreate) {
      try {
        preservedUserApiKeys = await db
          .select({
            name: apiKeysTable.name,
            key: apiKeysTable.key,
            is_active: apiKeysTable.is_active,
          })
          .from(apiKeysTable)
          .where(eq(apiKeysTable.user_id, existing.id));
      } catch (err) {
        console.warn("⚠️ Failed to preserve user API keys:", err);
      }
    }

    try {
      await db
        .delete(accountsTable)
        .where(eq(accountsTable.userId, existing.id));
    } catch (err) {
      console.warn("⚠️ Failed to delete accounts for user:", err);
    }

    try {
      await db
        .delete(apiKeysTable)
        .where(eq(apiKeysTable.user_id, existing.id));
    } catch (err) {
      console.warn("⚠️ Failed to delete user-scoped API keys:", err);
    }

    try {
      await db.delete(usersTable).where(eq(usersTable.id, existing.id));
    } catch (err) {
      console.warn("⚠️ Failed to delete existing user:", err);
    }
  }

  if (!existing || recreated) {
    // Create via Better Auth (this is the only supported way to ensure hashing matches)
    const request = new Request("http://internal/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        name: config.defaultUserName,
      }),
    });

    const response = await auth.handler(request);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(
        `⚠️ Better Auth sign-up failed (${response.status}). Continuing startup. ${
          body ? `Response: ${body}` : ""
        }`,
      );
      return { recreated };
    }
  }

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, email),
  });

  if (!user) {
    console.warn("⚠️ Default user not found after signup; skipping.");
    return { recreated };
  }

  // Keep metadata consistent
  try {
    await db
      .update(usersTable)
      .set({
        name: config.defaultUserName,
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));
  } catch (err) {
    console.warn("⚠️ Failed to update user metadata:", err);
  }

  // If we recreated and preserved keys, restore them now to the new user id
  if (recreated && config.preserveApiKeysOnRecreate && preservedUserApiKeys) {
    for (const k of preservedUserApiKeys) {
      try {
        await db
          .insert(apiKeysTable)
          .values({
            name: k.name,
            key: k.key,
            user_id: user.id,
            is_active: k.is_active,
          })
          .onConflictDoUpdate({
            target: [apiKeysTable.user_id, apiKeysTable.name],
            set: { key: k.key, is_active: k.is_active },
          });
      } catch (err) {
        console.warn("⚠️ Failed to restore preserved API key:", err);
      }
    }

    console.log("✓ Restored preserved API keys for recreated user");
  }

  // Record fingerprint only when we actually create/recreate (i.e., when env is authoritative)
  if (!existing || recreated) {
    await recordPasswordFingerprint(password);
  }

  console.log(`✓ Default user ready: ${email}`);
  return { userId: user.id, recreated };
}

async function maybeDeleteOtherUsers(
  config: EnvConfig,
  defaultUserEmail: string | undefined,
): Promise<void> {
  if (!config.deleteOtherUsers) return;
  if (!defaultUserEmail) {
    console.warn(
      "⚠️ BOOTSTRAP_DELETE_OTHER_USERS=true but BOOTSTRAP_USER_EMAIL is not set; skipping to avoid lockout.",
    );
    return;
  }

  console.warn(
    "⚠️ BOOTSTRAP_DELETE_OTHER_USERS=true — deleting all users except BOOTSTRAP_USER_EMAIL",
  );

  try {
    await db.delete(usersTable).where(ne(usersTable.email, defaultUserEmail));
    console.log("✓ Deleted other users");
  } catch (err) {
    console.warn("⚠️ Failed to delete other users:", err);
  }
}

/**
 * Create default API keys (public + private) if enabled.
 *
 * This includes:
 * - Public key: user_id IS NULL, name="public"
 * - Private key: user_id=<defaultUserId>, name="private"
 *
 * If keys are already present, they are not duplicated.
 * If private key exists and you re-run, we keep it unless you explicitly recreate user
 * and choose not to preserve keys.
 */
async function ensureDefaultApiKeys(
  config: EnvConfig,
  defaultUserId: string | undefined,
): Promise<void> {
  if (!config.defaultUserCreateApiKeys) return;

  console.log("🔑 Creating default API keys...");

  // Public key (global)
  try {
    const existingPublic = await db.query.apiKeysTable.findFirst({
      where: and(isNull(apiKeysTable.user_id), eq(apiKeysTable.name, "public")),
    });

    if (!existingPublic) {
      const key = generateApiKey();
      await db.insert(apiKeysTable).values({
        name: "public",
        key,
        user_id: null,
        is_active: true,
      });
      console.log(`✓ Created default public API key: ${maskKey(key)}`);
    } else {
      console.log(
        `✓ Default public API key already exists: ${maskKey(existingPublic.key)}`,
      );
    }
  } catch (err) {
    console.warn("⚠️ Failed to ensure public API key:", err);
  }

  // Private key (user-scoped)
  if (!defaultUserId) {
    console.warn(
      "⚠️ Cannot create private API key because default user was not created/resolved.",
    );
    return;
  }

  try {
    const existingPrivate = await db.query.apiKeysTable.findFirst({
      where: and(
        eq(apiKeysTable.user_id, defaultUserId),
        eq(apiKeysTable.name, "private"),
      ),
    });

    if (!existingPrivate) {
      const key = generateApiKey();
      await db.insert(apiKeysTable).values({
        name: "private",
        key,
        user_id: defaultUserId,
        is_active: true,
      });
      console.log(`✓ Created default private API key: ${maskKey(key)}`);
    } else {
      console.log(
        `✓ Default private API key already exists: ${maskKey(existingPrivate.key)}`,
      );
    }
  } catch (err) {
    console.warn("⚠️ Failed to ensure private API key:", err);
  }
}

async function ensureDefaultNamespace(
  config: EnvConfig,
  defaultUserId: string | undefined,
): Promise<string | undefined> {
  const name = config.defaultNamespaceName;
  if (!name) {
    console.warn(
      "⚠️ BOOTSTRAP_NAMESPACE not set; skipping namespace initialization.",
    );
    return undefined;
  }

  const ownerUserId = config.defaultNamespaceIsPublic ? null : defaultUserId;
  if (!config.defaultNamespaceIsPublic && !defaultUserId) {
    console.warn(
      "⚠️ BOOTSTRAP_NAMESPACE_IS_PUBLIC=false but default user id is unavailable; skipping namespace initialization.",
    );
    return undefined;
  }

  console.log(`🔧 Initializing default namespace: ${name}`);

  try {
    // FIXED: Look for namespace by name AND user_id (or NULL for public)
    const whereCondition = ownerUserId
      ? and(eq(namespacesTable.name, name), eq(namespacesTable.user_id, ownerUserId))
      : and(eq(namespacesTable.name, name), isNull(namespacesTable.user_id));

    const existing = await db.query.namespacesTable.findFirst({
      where: whereCondition,
    });

    if (!existing) {
      const inserted = await db
        .insert(namespacesTable)
        .values({
          name,
          description: config.defaultNamespaceDescription ?? null,
          user_id: ownerUserId,
        })
        .returning({ uuid: namespacesTable.uuid });

      const uuid = inserted?.[0]?.uuid;
      if (uuid) {
        console.log(`✓ Created default namespace: ${name} (${ownerUserId ? 'private' : 'public'})`);
        return uuid;
      }

      console.warn("⚠️ Namespace insert did not return uuid; continuing.");
      return undefined;
    }

    if (config.defaultNamespaceUpdateIfExists) {
      await db
        .update(namespacesTable)
        .set({
          description:
            config.defaultNamespaceDescription ?? existing.description,
          updated_at: new Date(),
          user_id: ownerUserId,
        })
        .where(eq(namespacesTable.uuid, existing.uuid));

      console.log(`✓ Updated default namespace: ${name}`);
    } else {
      console.log(`✓ Default namespace already exists: ${name}`);
    }

    return existing.uuid;
  } catch (err) {
    console.warn("⚠️ Namespace initialization failed:", err);
    return undefined;
  }
}

async function ensureDefaultEndpoint(
  config: EnvConfig,
  namespaceUuid: string | undefined,
  defaultUserId: string | undefined,
): Promise<void> {
  const name = config.defaultEndpointName;
  if (!name) {
    console.warn(
      "⚠️ BOOTSTRAP_ENDPOINT not set; skipping endpoint initialization.",
    );
    return;
  }
  if (!namespaceUuid) {
    console.warn(
      "⚠️ Cannot initialize endpoint because namespace UUID is not available.",
    );
    return;
  }

  const ownerUserId = config.defaultEndpointIsPublic ? null : defaultUserId;
  if (!config.defaultEndpointIsPublic && !defaultUserId) {
    console.warn(
      "⚠️ BOOTSTRAP_ENDPOINT_IS_PUBLIC=false but default user id is unavailable; skipping endpoint initialization.",
    );
    return;
  }

  console.log(`🔧 Initializing default endpoint: ${name}`);

  try {
    // FIXED: Look for endpoint by name AND namespace_uuid
    const existing = await db.query.endpointsTable.findFirst({
      where: and(
        eq(endpointsTable.name, name),
        eq(endpointsTable.namespace_uuid, namespaceUuid)
      ),
    });

    const values = {
      name,
      description: config.defaultEndpointDescription ?? null,
      namespace_uuid: namespaceUuid,
      enable_api_key_auth: config.defaultEndpointEnableApiKeyAuth,
      use_query_param_auth: config.defaultEndpointUseQueryParamAuth,
      enable_oauth: config.defaultEndpointEnableOauth,
      user_id: ownerUserId,
      updated_at: new Date(),
    };

    if (!existing) {
      await db.insert(endpointsTable).values(values);
      console.log(`✓ Created default endpoint: ${name}`);
      return;
    }

    if (config.defaultEndpointUpdateIfExists) {
      await db
        .update(endpointsTable)
        .set(values)
        .where(eq(endpointsTable.uuid, existing.uuid));
      console.log(`✓ Updated default endpoint: ${name}`);
    } else {
      console.log(`✓ Default endpoint already exists: ${name}`);
    }
  } catch (err) {
    console.warn("⚠️ Endpoint initialization failed:", err);
  }
}

function validateConfig(config: EnvConfig): void {
  if (
    config.disableUiRegistration &&
    config.disableSsoRegistration &&
    (!config.defaultUserEmail || !config.defaultUserPassword)
  ) {
    console.warn(
      "⚠️ Both UI and SSO registration are disabled, but BOOTSTRAP_USER_EMAIL/BOOTSTRAP_USER_PASSWORD are not set. This may lock you out.",
    );
  }

  if (config.recreateDefaultUser && !config.defaultUserEmail) {
    console.warn(
      "⚠️ BOOTSTRAP_RECREATE_USER=true but BOOTSTRAP_USER_EMAIL is not set; recreation cannot run.",
    );
  }

  // Additional validation warnings
  if (config.defaultUserPassword && config.defaultUserPassword.length < 8) {
    console.warn(
      "⚠️ BOOTSTRAP_USER_PASSWORD is less than 8 characters. Consider using a stronger password.",
    );
  }

  if (config.recreateDefaultUser && !config.preserveApiKeysOnRecreate) {
    console.warn(
      "⚠️ BOOTSTRAP_RECREATE_USER=true and BOOTSTRAP_PRESERVE_API_KEYS=false",
    );
    console.warn(
      "     This will delete all API keys for the user!",
    );
  }

  if (config.deleteOtherUsers && !config.defaultUserEmail) {
    console.warn(
      "⚠️ BOOTSTRAP_DELETE_OTHER_USERS=true without BOOTSTRAP_USER_EMAIL set",
    );
    console.warn(
      "     This could lock you out of the system!",
    );
  }

  if (config.defaultEndpointName && !config.defaultNamespaceName) {
    console.warn(
      "⚠️ BOOTSTRAP_ENDPOINT is set but BOOTSTRAP_NAMESPACE is not",
    );
    console.warn(
      "     Endpoint creation requires a namespace!",
    );
  }
}

export async function initializeEnvironmentConfiguration(): Promise<void> {
  console.log("🚀 Initializing environment-based configuration...");
  const config = parseEnvConfig();
  
  // Log configuration summary for debugging
  if (process.env.BOOTSTRAP_DEBUG === "true") {
    console.log("📋 Bootstrap Configuration:");
    console.log(`   User: ${config.defaultUserEmail ?? '(not set)'}`);
    console.log(`   Namespace: ${config.defaultNamespaceName ?? '(not set)'}`);
    console.log(`   Endpoint: ${config.defaultEndpointName ?? '(not set)'}`);
    console.log(`   Recreate User: ${config.recreateDefaultUser}`);
    console.log(`   First Run Only: ${config.bootstrapOnlyOnFirstRun}`);
    console.log(`   Delete Others: ${config.deleteOtherUsers}`);
  }
  
  validateConfig(config);

  // Registration controls should be applied every run (safe and non-destructive)
  console.log("🔧 Setting registration controls...");
  try {
    await upsertConfig(
      ConfigKeyEnum.Enum.DISABLE_SIGNUP,
      config.disableUiRegistration.toString(),
      "Whether new user signup is disabled",
    );
  } catch (err) {
    console.warn("⚠️ Failed to set UI registration control:", err);
  }

  try {
    await upsertConfig(
      ConfigKeyEnum.Enum.DISABLE_SSO_SIGNUP,
      config.disableSsoRegistration.toString(),
      "Whether new user signup via SSO/OAuth is disabled",
    );
  } catch (err) {
    console.warn("⚠️ Failed to set SSO registration control:", err);
  }

  console.log(
    `✓ Registration controls set: UI=${!config.disableUiRegistration}, SSO=${!config.disableSsoRegistration}`,
  );

  // One-time bootstrap guard: skips destructive/creation steps after first success
  const skipBootstrap = await shouldSkipBootstrap(config);
  if (skipBootstrap) {
    console.log("✅ Environment-based configuration initialized (guarded)");
    return;
  }

  // Optionally delete other users BEFORE ensuring default user (so recreate doesn’t get wiped)
  try {
    await maybeDeleteOtherUsers(config, config.defaultUserEmail);
  } catch (err) {
    console.warn("⚠️ User cleanup step failed:", err);
  }

  // Default user
  let defaultUserId: string | undefined;
  let recreated = false;
  try {
    const result = await ensureDefaultUser(config);
    defaultUserId = result.userId;
    recreated = result.recreated;
  } catch (err) {
    console.warn("⚠️ Default user initialization failed:", err);
  }

  // API keys:
  // - If user was recreated and BOOTSTRAP_PRESERVE_API_KEYS=true, keys were restored.
  // - Regardless, if BOOTSTRAP_CREATE_API_KEYS=true, we ensure public/private exist.
  //   This covers both fresh installs and restores that didn’t include "private".
  try {
    await ensureDefaultApiKeys(config, defaultUserId);
  } catch (err) {
    console.warn("⚠️ API key initialization failed:", err);
  }

  // Namespace + endpoint (optional)
  let namespaceUuid: string | undefined;
  try {
    namespaceUuid = await ensureDefaultNamespace(config, defaultUserId);
  } catch (err) {
    console.warn("⚠️ Namespace initialization failed:", err);
  }

  try {
    await ensureDefaultEndpoint(config, namespaceUuid, defaultUserId);
  } catch (err) {
    console.warn("⚠️ Endpoint initialization failed:", err);
  }

  // Mark one-time bootstrap complete only if we actually did the bootstrap pass
  // (best-effort; do not fail startup)
  if (config.bootstrapOnlyOnFirstRun) {
    // Heuristic: if we have a default user OR we created namespace/endpoint, consider it “complete”.
    // If you want stricter semantics, we can tighten this.
    if (defaultUserId || namespaceUuid || recreated) {
      await markBootstrapComplete();
    }
  }

  console.log("✅ Environment-based configuration initialized successfully");
}
