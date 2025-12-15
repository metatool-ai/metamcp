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
 * Supports arrays of API Keys, Namespaces, and Endpoints via JSON environment variables.
 */

type ApiKeyConfig = {
  name: string;
  is_public?: boolean;
};

type NamespaceConfig = {
  name: string;
  description?: string;
  is_public?: boolean;
  update?: boolean;
};

type EndpointConfig = {
  name: string;
  description?: string;
  enable_auth?: boolean;
  enable_auth_query?: boolean;
  enable_auth_oauth?: boolean;
  is_public?: boolean;
  update?: boolean;
};

type EnvConfig = {
  // Default user
  defaultUserEmail?: string;
  defaultUserPassword?: string;
  defaultUserName: string;
  deleteOtherUsers: boolean;

  // User lifecycle / safety
  recreateDefaultUser: boolean;
  preserveApiKeysOnRecreate: boolean;
  warnOnPasswordChange: boolean;
  bootstrapOnlyOnFirstRun: boolean;

  // Registration controls
  disableUiRegistration: boolean;
  disableSsoRegistration: boolean;

  // Array configurations
  apiKeys: ApiKeyConfig[];
  namespaces: NamespaceConfig[];
  endpoints: EndpointConfig[];
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

function parseJsonArray<T>(envVar: string | undefined, defaultValue: T[]): T[] {
  if (!envVar) return defaultValue;
  
  try {
    const parsed = JSON.parse(envVar);
    if (!Array.isArray(parsed)) {
      console.warn(`⚠️ Environment variable is not an array, using default: ${envVar.slice(0, 50)}...`);
      return defaultValue;
    }
    return parsed as T[];
  } catch (err) {
    console.warn(`⚠️ Failed to parse JSON array from environment variable: ${err}`);
    return defaultValue;
  }
}

function parseEnvConfig(): EnvConfig {
  return {
    // Default user
    defaultUserEmail: nonEmpty(process.env.BOOTSTRAP_USER_EMAIL),
    defaultUserPassword: nonEmpty(process.env.BOOTSTRAP_USER_PASSWORD),
    defaultUserName: nonEmpty(process.env.BOOTSTRAP_USER_NAME) ?? "Administrator",
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

    // Array configurations
    apiKeys: parseJsonArray<ApiKeyConfig>(process.env.BOOTSTRAP_API_KEYS, []),
    namespaces: parseJsonArray<NamespaceConfig>(process.env.BOOTSTRAP_NAMESPACES, []),
    endpoints: parseJsonArray<EndpointConfig>(process.env.BOOTSTRAP_ENDPOINTS, []),
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
    // Create via Better Auth
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

  // Restore preserved keys if recreated
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

  // Record fingerprint when we actually create/recreate
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
 * Bootstrap API keys from configuration array.
 */
async function bootstrapApiKeys(
  config: EnvConfig,
  defaultUserId: string | undefined,
): Promise<void> {
  if (!config.apiKeys || config.apiKeys.length === 0) {
    console.log("ℹ️ No API keys configured for bootstrap (BOOTSTRAP_API_KEYS is empty)");
    return;
  }

  console.log(`🔑 Bootstrapping ${config.apiKeys.length} API key(s)...`);

  for (const apiKeyConfig of config.apiKeys) {
    try {
      const name = apiKeyConfig.name;
      const isPublic = apiKeyConfig.is_public ?? false;
      const userId = isPublic ? null : defaultUserId;

      if (!isPublic && !defaultUserId) {
        console.warn(
          `⚠️ Skipping private API key "${name}" because default user is not available`,
        );
        continue;
      }

      // Check if key already exists
      const whereCondition = userId
        ? and(eq(apiKeysTable.user_id, userId), eq(apiKeysTable.name, name))
        : and(isNull(apiKeysTable.user_id), eq(apiKeysTable.name, name));

      const existing = await db.query.apiKeysTable.findFirst({
        where: whereCondition,
      });

      if (!existing) {
        const key = generateApiKey();
        await db.insert(apiKeysTable).values({
          name,
          key,
          user_id: userId,
          is_active: true,
        });
        console.log(
          `✓ Created ${isPublic ? "public" : "private"} API key "${name}": ${maskKey(key)}`,
        );
      } else {
        console.log(
          `✓ ${isPublic ? "Public" : "Private"} API key "${name}" already exists: ${maskKey(existing.key)}`,
        );
      }
    } catch (err) {
      console.warn(`⚠️ Failed to bootstrap API key "${apiKeyConfig.name}":`, err);
    }
  }
}

/**
 * Bootstrap namespaces from configuration array.
 */
async function bootstrapNamespaces(
  config: EnvConfig,
  defaultUserId: string | undefined,
): Promise<Map<string, string>> {
  const namespaceMap = new Map<string, string>(); // name -> uuid
  
  if (!config.namespaces || config.namespaces.length === 0) {
    console.log("ℹ️ No namespaces configured for bootstrap (BOOTSTRAP_NAMESPACES is empty)");
    return namespaceMap;
  }

  console.log(`🔧 Bootstrapping ${config.namespaces.length} namespace(s)...`);

  for (const nsConfig of config.namespaces) {
    try {
      const name = nsConfig.name;
      const description = nsConfig.description ?? null;
      const isPublic = nsConfig.is_public ?? false;
      const shouldUpdate = nsConfig.update ?? true;
      const ownerUserId = isPublic ? null : defaultUserId;

      if (!isPublic && !defaultUserId) {
        console.warn(
          `⚠️ Skipping private namespace "${name}" because default user is not available`,
        );
        continue;
      }

      // Look for existing namespace
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
            description,
            user_id: ownerUserId,
          })
          .returning({ uuid: namespacesTable.uuid });

        const uuid = inserted?.[0]?.uuid;
        if (uuid) {
          namespaceMap.set(name, uuid);
          console.log(`✓ Created ${isPublic ? "public" : "private"} namespace "${name}"`);
        } else {
          console.warn(`⚠️ Namespace insert for "${name}" did not return uuid`);
        }
      } else {
        namespaceMap.set(name, existing.uuid);
        
        if (shouldUpdate) {
          await db
            .update(namespacesTable)
            .set({
              description: description ?? existing.description,
              updated_at: new Date(),
              user_id: ownerUserId,
            })
            .where(eq(namespacesTable.uuid, existing.uuid));

          console.log(`✓ Updated namespace "${name}"`);
        } else {
          console.log(`✓ Namespace "${name}" already exists (no update)`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ Failed to bootstrap namespace "${nsConfig.name}":`, err);
    }
  }

  return namespaceMap;
}

/**
 * Bootstrap endpoints from configuration array.
 */
async function bootstrapEndpoints(
  config: EnvConfig,
  namespaceMap: Map<string, string>,
  defaultUserId: string | undefined,
): Promise<void> {
  if (!config.endpoints || config.endpoints.length === 0) {
    console.log("ℹ️ No endpoints configured for bootstrap (BOOTSTRAP_ENDPOINTS is empty)");
    return;
  }

  console.log(`🔧 Bootstrapping ${config.endpoints.length} endpoint(s)...`);

  for (const epConfig of config.endpoints) {
    try {
      const name = epConfig.name;
      const description = epConfig.description ?? null;
      const enableAuth = epConfig.enable_auth ?? true;
      const enableAuthQuery = epConfig.enable_auth_query ?? false;
      const enableAuthOauth = epConfig.enable_auth_oauth ?? false;
      const isPublic = epConfig.is_public ?? true;
      const shouldUpdate = epConfig.update ?? true;
      const ownerUserId = isPublic ? null : defaultUserId;

      if (!isPublic && !defaultUserId) {
        console.warn(
          `⚠️ Skipping private endpoint "${name}" because default user is not available`,
        );
        continue;
      }

      // Find the namespace UUID - endpoints need to specify which namespace they belong to
      // For now, we'll use the first namespace in the map or skip if no namespaces
      let namespaceUuid: string | undefined;
      if (namespaceMap.size > 0) {
        namespaceUuid = Array.from(namespaceMap.values())[0];
      }

      if (!namespaceUuid) {
        console.warn(
          `⚠️ Skipping endpoint "${name}" because no namespace is available. Bootstrap at least one namespace first.`,
        );
        continue;
      }

      // Look for existing endpoint
      const existing = await db.query.endpointsTable.findFirst({
        where: and(
          eq(endpointsTable.name, name),
          eq(endpointsTable.namespace_uuid, namespaceUuid)
        ),
      });

      const values = {
        name,
        description,
        namespace_uuid: namespaceUuid,
        enable_api_key_auth: enableAuth,
        use_query_param_auth: enableAuthQuery,
        enable_oauth: enableAuthOauth,
        user_id: ownerUserId,
        updated_at: new Date(),
      };

      if (!existing) {
        await db.insert(endpointsTable).values(values);
        console.log(`✓ Created ${isPublic ? "public" : "private"} endpoint "${name}"`);
      } else {
        if (shouldUpdate) {
          await db
            .update(endpointsTable)
            .set(values)
            .where(eq(endpointsTable.uuid, existing.uuid));
          console.log(`✓ Updated endpoint "${name}"`);
        } else {
          console.log(`✓ Endpoint "${name}" already exists (no update)`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ Failed to bootstrap endpoint "${epConfig.name}":`, err);
    }
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

  // Validate API keys configuration
  for (const apiKey of config.apiKeys) {
    if (!apiKey.name || apiKey.name.trim() === "") {
      console.warn("⚠️ API key configuration is missing 'name' field");
    }
  }

  // Validate namespaces configuration
  for (const ns of config.namespaces) {
    if (!ns.name || ns.name.trim() === "") {
      console.warn("⚠️ Namespace configuration is missing 'name' field");
    }
  }

  // Validate endpoints configuration
  for (const ep of config.endpoints) {
    if (!ep.name || ep.name.trim() === "") {
      console.warn("⚠️ Endpoint configuration is missing 'name' field");
    }
  }

  if (config.endpoints.length > 0 && config.namespaces.length === 0) {
    console.warn(
      "⚠️ Endpoints are configured but no namespaces are defined.",
    );
    console.warn(
      "     Endpoints require at least one namespace to be created!",
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
    console.log(`   API Keys: ${config.apiKeys.length} configured`);
    console.log(`   Namespaces: ${config.namespaces.length} configured`);
    console.log(`   Endpoints: ${config.endpoints.length} configured`);
    console.log(`   Recreate User: ${config.recreateDefaultUser}`);
    console.log(`   First Run Only: ${config.bootstrapOnlyOnFirstRun}`);
    console.log(`   Delete Others: ${config.deleteOtherUsers}`);
  }
  
  validateConfig(config);

  // Registration controls (applied every run)
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

  // One-time bootstrap guard
  const skipBootstrap = await shouldSkipBootstrap(config);
  if (skipBootstrap) {
    console.log("✅ Environment-based configuration initialized (guarded)");
    return;
  }

  // Delete other users before ensuring default user
  try {
    await maybeDeleteOtherUsers(config, config.defaultUserEmail);
  } catch (err) {
    console.warn("⚠️ User cleanup step failed:", err);
  }

  // Ensure default user
  let defaultUserId: string | undefined;
  let recreated = false;
  try {
    const result = await ensureDefaultUser(config);
    defaultUserId = result.userId;
    recreated = result.recreated;
  } catch (err) {
    console.warn("⚠️ Default user initialization failed:", err);
  }

  // Bootstrap API keys
  try {
    await bootstrapApiKeys(config, defaultUserId);
  } catch (err) {
    console.warn("⚠️ API keys bootstrap failed:", err);
  }

  // Bootstrap namespaces and collect UUID mappings
  let namespaceMap: Map<string, string>;
  try {
    namespaceMap = await bootstrapNamespaces(config, defaultUserId);
  } catch (err) {
    console.warn("⚠️ Namespaces bootstrap failed:", err);
    namespaceMap = new Map();
  }

  // Bootstrap endpoints
  try {
    await bootstrapEndpoints(config, namespaceMap, defaultUserId);
  } catch (err) {
    console.warn("⚠️ Endpoints bootstrap failed:", err);
  }

  // Mark one-time bootstrap complete
  if (config.bootstrapOnlyOnFirstRun) {
    if (defaultUserId || namespaceMap.size > 0 || recreated) {
      await markBootstrapComplete();
    }
  }

  console.log("✅ Environment-based configuration initialized successfully");
}
