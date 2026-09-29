import { randomBytes } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import logger from "@/utils/logger";

import { db } from "../../db/index";
import {
  encryptionKeysTable,
  mcpServersTable,
  oauthSessionsTable,
} from "../../db/schema";
import { activityLog } from "../activity/activity-log.service";
import { pickActiveKey } from "./active-key";
import {
  createProviders,
  KeyEncryptionProvider,
  KeyUnavailableError,
  OpenBaoTransitProvider,
  ProviderSetup,
  TransientKeyError,
} from "./kek-providers";
import {
  decryptSecret,
  decryptSecretJson,
  decryptSecretMap,
  encryptedWithKeyId,
  generateDataKey,
  getActiveKeyId,
  installKeyring,
} from "./keyring";

type KeyRow = typeof encryptionKeysTable.$inferSelect;

const REFRESH_INTERVAL_MS = 60_000;
// pg_advisory_xact_lock key serialising data key creation across instances
const KEY_CREATION_LOCK = 734_120_451;

/** `failed`: records that could not be re-encrypted (see runSweep). */
export type SweepResult = { scanned: number; updated: number; failed: number };

export type EncryptionKeyState = "active" | "pending" | "retired";

export type EncryptionStatus = {
  provider: KeyEncryptionProvider["name"];
  source: KeyEncryptionProvider["source"];
  details: Record<string, string>;
  usesExampleAuthSecret: boolean;
  activationDelaySeconds: number;
  keys: {
    id: string;
    kekProvider: string;
    createdAt: Date;
    activatedAt: Date;
    state: EncryptionKeyState;
    values: number;
  }[];
  plaintextValues: number;
};

function newKeyId(): string {
  return `k_${randomBytes(6).toString("hex")}`;
}

function activationDelaySeconds(): number {
  const value = process.env.SECRETS_KEY_ACTIVATION_DELAY_SECONDS?.trim();
  if (!value) return 150;
  const raw = Number(value);
  // Leaves time for every instance to load a new key (they refresh every
  // minute) before it is used to encrypt anything.
  if (!Number.isFinite(raw) || raw < 0) return 150;
  if (raw < 90) {
    logger.warn(
      `🔐 SECRETS_KEY_ACTIVATION_DELAY_SECONDS=${raw} is shorter than the key refresh of other instances (60 s): with several instances, some could read values encrypted with a key they have not loaded yet.`,
    );
  }
  return raw;
}

async function withRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  const attempts = 6;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof TransientKeyError) || attempt >= attempts) {
        throw error;
      }
      const delay = Math.min(2 ** attempt * 1000, 30_000);
      logger.warn(
        `🔐 ${label} failed (${error.message}); retrying in ${delay / 1000}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

type RawServerRow = {
  uuid: string;
  args: string[] | null;
  env: Record<string, unknown> | null;
  url: string | null;
  bearer_token: string | null;
  headers: Record<string, unknown> | null;
};

type RawOAuthSessionRow = {
  uuid: string;
  client_information: unknown;
  tokens: unknown;
  code_verifier: string | null;
};

function serverValues(row: RawServerRow): unknown[] {
  return [
    ...(row.args ?? []),
    ...Object.values(row.env ?? {}),
    row.url,
    row.bearer_token,
    ...Object.values(row.headers ?? {}),
  ];
}

function oauthSessionValues(row: RawOAuthSessionRow): unknown[] {
  // Legacy rows hold JSON objects: they count as one plaintext value.
  const json = (value: unknown) =>
    value === null || value === undefined
      ? null
      : typeof value === "string"
        ? value
        : Object.keys(value as object).length > 0
          ? JSON.stringify(value)
          : null;
  return [json(row.client_information), json(row.tokens), row.code_verifier];
}

const SERVER_COLUMNS = sql`uuid, args, env, url, bearer_token, headers`;
const OAUTH_SESSION_COLUMNS = sql`uuid, client_information, tokens, code_verifier`;

export class SecretsService {
  private setup: ProviderSetup | null = null;
  private readonly keys = new Map<string, Buffer>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private rotationTimer: NodeJS.Timeout | null = null;
  private sweeping: Promise<SweepResult> | null = null;
  /** Data keys ignored by the runtime refresh (reported once). */
  private readonly ignoredKeys = new Set<string>();

  /**
   * Loads (and on first start creates) the data keys, re-wraps them if the
   * key encryption key changed, then encrypts values still stored in clear
   * text. Must complete before anything reads or writes secrets.
   */
  async initialize(): Promise<void> {
    const setup = createProviders();
    this.setup = setup;
    for (const warning of setup.warnings) {
      logger.warn(`🔐 ${warning}`);
    }

    await withRetry("Creating the data encryption key", () =>
      this.ensureDataKey(),
    );
    await withRetry("Loading data encryption keys", () =>
      this.reload({ rewrap: true }),
    );
    logger.info(
      `🔐 Secrets encryption ready (${setup.primary.name}, active data key ${getActiveKeyId()})`,
    );

    const { updated, failed } = await this.sweep();
    if (updated > 0) {
      logger.info(`🔐 Encrypted ${updated} record(s) with the active data key`);
    }
    if (failed > 0) {
      logger.error(
        `🔐 ${failed} record(s) could not be decrypted with the configured keys and were left as is (see the errors above).`,
      );
    }
    this.startRefreshLoop();
  }

  /** Stops the background key refresh (tests, shutdown). */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  /**
   * Creates a new data key. It becomes active after the activation delay so
   * that every instance has loaded it first; values are then re-encrypted.
   */
  async rotateDataKey(): Promise<{ keyId: string; activatesAt: Date }> {
    const setup = this.requireSetup();
    const id = newKeyId();
    const dataKey = generateDataKey();
    const wrapped = await setup.primary.wrap(dataKey, id);
    const delay = activationDelaySeconds();
    const activatesAt = new Date(Date.now() + delay * 1000);

    await db.insert(encryptionKeysTable).values({
      id,
      wrapped_key: wrapped.wrapped,
      kek_provider: wrapped.kekProvider,
      kek_id: wrapped.kekId,
      activated_at: activatesAt,
    });
    this.keys.set(id, dataKey);
    await this.reload({ rewrap: false });

    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    const timer = setTimeout(
      () => {
        this.rotationTimer = null;
        void this.reload({ rewrap: false })
          .then(() => this.sweep())
          .catch((error) =>
            logger.error("🔐 Re-encryption after key rotation failed:", error),
          );
      },
      delay * 1000 + 1000,
    );
    timer.unref?.();
    this.rotationTimer = timer;

    logger.info(
      `🔐 Data key ${id} created; it becomes active at ${activatesAt.toISOString()}`,
    );
    return { keyId: id, activatesAt };
  }

  async getStatus(): Promise<EncryptionStatus> {
    const setup = this.requireSetup();
    const rows = await db
      .select()
      .from(encryptionKeysTable)
      .orderBy(asc(encryptionKeysTable.activated_at));
    const now = new Date();
    const active = pickActiveKey(rows, now);
    const counts = await this.countValues();

    return {
      provider: setup.primary.name,
      source: setup.primary.source,
      details: setup.primary.describe(),
      usesExampleAuthSecret: setup.usesExampleAuthSecret,
      activationDelaySeconds: activationDelaySeconds(),
      keys: rows.map((row) => ({
        id: row.id,
        kekProvider: row.kek_provider,
        createdAt: row.created_at,
        activatedAt: row.activated_at,
        state:
          row.id === active?.id
            ? "active"
            : row.activated_at.getTime() > now.getTime()
              ? "pending"
              : "retired",
        values: counts.byKey.get(row.id) ?? 0,
      })),
      plaintextValues: counts.plaintext,
    };
  }

  /**
   * Encrypts clear-text values and re-encrypts values that use an older data
   * key. Idempotent and safe to run on several instances at once.
   */
  sweep(): Promise<SweepResult> {
    if (!this.sweeping) {
      this.sweeping = this.runSweep().finally(() => {
        this.sweeping = null;
      });
    }
    return this.sweeping;
  }

  // -------------------------------------------------------------------------

  private requireSetup(): ProviderSetup {
    if (!this.setup) {
      throw new Error("Secrets encryption is not initialized");
    }
    return this.setup;
  }

  private providerFor(row: KeyRow): KeyEncryptionProvider {
    const setup = this.requireSetup();
    const provider = [setup.primary, ...setup.fallbacks].find(
      (candidate) => candidate.name === row.kek_provider,
    );
    if (!provider) {
      throw new KeyUnavailableError(
        `data key ${row.id} is wrapped by ${row.kek_provider} (${row.kek_id}), which is not configured. Configure it again (at least temporarily) so MetaMCP can re-wrap its keys.`,
      );
    }
    return provider;
  }

  private async ensureDataKey(): Promise<void> {
    const setup = this.requireSetup();
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${KEY_CREATION_LOCK})`);
      const [existing] = await tx
        .select({ id: encryptionKeysTable.id })
        .from(encryptionKeysTable)
        .limit(1);
      if (existing) return;

      const id = newKeyId();
      const dataKey = generateDataKey();
      const wrapped = await setup.primary.wrap(dataKey, id);
      await tx.insert(encryptionKeysTable).values({
        id,
        wrapped_key: wrapped.wrapped,
        kek_provider: wrapped.kekProvider,
        kek_id: wrapped.kekId,
      });
      this.keys.set(id, dataKey);
      logger.info(`🔐 Created data encryption key ${id} (${wrapped.kekId})`);
    });
  }

  private async reload(options: { rewrap: boolean }): Promise<string> {
    const allRows = await db.select().from(encryptionKeysTable);
    const primary = this.requireSetup().primary;
    // At runtime, a new data key is only accepted when it is wrapped by the
    // current primary KEK (as instances rotating keys do). Keys wrapped by an
    // older or fallback KEK are only taken over at startup: someone able to
    // write to the database must not be able to plant a data key wrapped
    // with a weaker, retired key and have it become the active one.
    const rows = allRows.filter(
      (row) =>
        options.rewrap ||
        this.keys.has(row.id) ||
        (row.kek_provider === primary.name &&
          row.kek_id === primary.currentKekId()),
    );
    for (const row of allRows) {
      if (!rows.includes(row) && !this.ignoredKeys.has(row.id)) {
        this.ignoredKeys.add(row.id);
        logger.warn(
          `🔐 Data key ${row.id} is wrapped by ${row.kek_id}, not by the current key: ignored until the next restart`,
        );
      }
    }
    for (const row of rows) {
      if (!this.keys.has(row.id)) {
        const key = await this.providerFor(row).unwrap(
          row.wrapped_key,
          row.kek_id,
          row.id,
        );
        this.keys.set(row.id, key);
      }
      if (options.rewrap) {
        await this.rewrapIfNeeded(row);
      }
    }

    const active = pickActiveKey(rows, new Date());
    if (!active) {
      throw new KeyUnavailableError("No data encryption key is available.");
    }
    installKeyring({ activeKeyId: active.id, keys: new Map(this.keys) });
    return active.id;
  }

  private async rewrapIfNeeded(row: KeyRow): Promise<void> {
    const primary = this.requireSetup().primary;
    const key = this.keys.get(row.id);
    if (!key) return;

    if (
      row.kek_provider === primary.name &&
      row.kek_id === primary.currentKekId()
    ) {
      if (primary instanceof OpenBaoTransitProvider) {
        // Move to the newest Transit key version, so old versions can be
        // retired in OpenBao. Needs "update" on transit/rewrap/<key>.
        try {
          const rewrapped = await primary.rewrap(row.wrapped_key);
          if (rewrapped !== row.wrapped_key) {
            await this.updateWrappedKey(
              row,
              rewrapped,
              row.kek_provider,
              row.kek_id,
            );
          }
        } catch (error) {
          logger.info(
            `🔐 Data key ${row.id} kept on its Transit key version (${error instanceof Error ? error.message : String(error)})`,
          );
        }
      }
      return;
    }

    const wrapped = await primary.wrap(key, row.id);
    const updated = await this.updateWrappedKey(
      row,
      wrapped.wrapped,
      wrapped.kekProvider,
      wrapped.kekId,
    );
    // Another instance re-wrapped it first: it recorded the change
    if (!updated) return;
    logger.info(`🔐 Data key ${row.id} re-wrapped with ${wrapped.kekId}`);
    await activityLog.record({
      actor: { kind: "system", label: "Startup" },
      action: "secrets.data_key_rewrapped",
      target: { type: "encryption_key", id: row.id, label: row.id },
      details: { from: row.kek_id, to: wrapped.kekId },
    });
  }

  /** Compare-and-swap on the wrapped value; false when another won. */
  private async updateWrappedKey(
    row: KeyRow,
    wrappedKey: string,
    kekProvider: string,
    kekId: string,
  ): Promise<boolean> {
    const updated = await db
      .update(encryptionKeysTable)
      .set({
        wrapped_key: wrappedKey,
        kek_provider: kekProvider,
        kek_id: kekId,
      })
      .where(
        and(
          eq(encryptionKeysTable.id, row.id),
          eq(encryptionKeysTable.wrapped_key, row.wrapped_key),
        ),
      )
      .returning({ id: encryptionKeysTable.id });
    return updated.length > 0;
  }

  private startRefreshLoop(): void {
    this.stop();
    this.refreshTimer = setInterval(() => {
      const previous = getActiveKeyId();
      this.reload({ rewrap: false })
        .then((active) => {
          if (active !== previous) {
            logger.info(`🔐 Data key ${active} is now active`);
            return this.sweep().then(() => undefined);
          }
          return undefined;
        })
        .catch((error) =>
          logger.warn(
            `🔐 Refreshing data encryption keys failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }, REFRESH_INTERVAL_MS);
    this.refreshTimer.unref?.();
  }

  private needsWork(value: unknown): boolean {
    return (
      typeof value === "string" &&
      value !== "" &&
      encryptedWithKeyId(value) !== getActiveKeyId()
    );
  }

  private async runSweep(): Promise<SweepResult> {
    let scanned = 0;
    let updated = 0;
    let failed = 0;
    // One unreadable record (restored with another key set, edited by hand)
    // must not stop the others, nor the startup: it is reported and skipped,
    // and stays counted as pending in the encryption status.
    const attempt = async (
      table: string,
      uuid: string,
      work: () => Promise<boolean>,
    ): Promise<void> => {
      try {
        if (await work()) updated++;
      } catch (error) {
        failed++;
        logger.error(
          `🔐 Could not re-encrypt ${table} record ${uuid}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    const servers = await db.execute<RawServerRow>(
      sql`select ${SERVER_COLUMNS} from mcp_servers`,
    );
    for (const row of servers.rows) {
      scanned++;
      if (!serverValues(row).some((value) => this.needsWork(value))) continue;
      await attempt("mcp_servers", row.uuid, () =>
        db.transaction(async (tx) => {
          const fresh = await tx.execute<RawServerRow>(
            sql`select ${SERVER_COLUMNS} from mcp_servers where uuid = ${row.uuid} for update`,
          );
          const current = fresh.rows[0];
          if (
            !current ||
            !serverValues(current).some((value) => this.needsWork(value))
          ) {
            return false;
          }
          // Decrypted values are re-encrypted with the active key on write.
          await tx
            .update(mcpServersTable)
            .set({
              args: (current.args ?? []).map((arg) =>
                decryptSecret(arg, "mcp_servers.args"),
              ),
              env: decryptSecretMap(current.env ?? {}, "mcp_servers.env"),
              url:
                current.url === null
                  ? null
                  : decryptSecret(current.url, "mcp_servers.url"),
              bearerToken:
                current.bearer_token === null
                  ? null
                  : decryptSecret(
                      current.bearer_token,
                      "mcp_servers.bearer_token",
                    ),
              headers: decryptSecretMap(
                current.headers ?? {},
                "mcp_servers.headers",
              ),
            })
            .where(eq(mcpServersTable.uuid, current.uuid));
          return true;
        }),
      );
    }

    const sessions = await db.execute<RawOAuthSessionRow>(
      sql`select ${OAUTH_SESSION_COLUMNS} from oauth_sessions`,
    );
    for (const row of sessions.rows) {
      scanned++;
      if (!oauthSessionValues(row).some((value) => this.needsWork(value))) {
        continue;
      }
      await attempt("oauth_sessions", row.uuid, () =>
        db.transaction(async (tx) => {
          const fresh = await tx.execute<RawOAuthSessionRow>(
            sql`select ${OAUTH_SESSION_COLUMNS} from oauth_sessions where uuid = ${row.uuid} for update`,
          );
          const current = fresh.rows[0];
          if (
            !current ||
            !oauthSessionValues(current).some((value) => this.needsWork(value))
          ) {
            return false;
          }
          await tx
            .update(oauthSessionsTable)
            .set({
              client_information: decryptSecretJson(
                current.client_information ?? {},
                "oauth_sessions.client_information",
              ),
              tokens:
                current.tokens === null || current.tokens === undefined
                  ? null
                  : decryptSecretJson(current.tokens, "oauth_sessions.tokens"),
              code_verifier:
                current.code_verifier === null
                  ? null
                  : decryptSecret(
                      current.code_verifier,
                      "oauth_sessions.code_verifier",
                    ),
            })
            .where(eq(oauthSessionsTable.uuid, current.uuid));
          return true;
        }),
      );
    }

    return { scanned, updated, failed };
  }

  private async countValues(): Promise<{
    byKey: Map<string, number>;
    plaintext: number;
  }> {
    const byKey = new Map<string, number>();
    let plaintext = 0;
    const count = (value: unknown) => {
      if (typeof value !== "string" || value === "") return;
      const keyId = encryptedWithKeyId(value);
      if (keyId) byKey.set(keyId, (byKey.get(keyId) ?? 0) + 1);
      else plaintext++;
    };

    const servers = await db.execute<RawServerRow>(
      sql`select ${SERVER_COLUMNS} from mcp_servers`,
    );
    servers.rows.forEach((row) => serverValues(row).forEach(count));
    const sessions = await db.execute<RawOAuthSessionRow>(
      sql`select ${OAUTH_SESSION_COLUMNS} from oauth_sessions`,
    );
    sessions.rows.forEach((row) => oauthSessionValues(row).forEach(count));
    return { byKey, plaintext };
  }
}

export const secretsService = new SecretsService();
