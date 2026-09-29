import {
  ApiKeyCreateInputSchema,
  ApiKeyListItem,
  ApiKeyScope,
  ApiKeyUpdateInput,
} from "@repo/zod-types";
import { and, desc, eq, inArray, isNull, or, SQL } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import type { z } from "zod";

import { hashToken, previewApiKey } from "../../lib/secrets/token-hash";
import { db } from "../index";
import {
  apiKeyEndpointsTable,
  apiKeysTable,
  endpointsTable,
  usersTable,
} from "../schema";

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  64,
);

/** New API key: sk_mt_{64-char-nanoid}. */
export function generateApiKey(): string {
  return `sk_mt_${nanoid()}`;
}

/** Columns stored for a key: its SHA-256 digest and a preview, never the key. */
export function storedApiKeyFields(key: string) {
  return { key_hash: hashToken(key), key_preview: previewApiKey(key) };
}

/**
 * Which keys a caller may manage: their own, plus organisation keys
 * (administrators). Never the personal keys of other users.
 */
export type ApiKeyManagementScope = {
  userId: string;
  organization?: boolean;
};

function manageableBy(scope: ApiKeyManagementScope): SQL {
  const own = eq(apiKeysTable.user_id, scope.userId);
  return scope.organization
    ? (or(own, isNull(apiKeysTable.user_id)) ?? own)
    : own;
}

const keyColumns = {
  uuid: apiKeysTable.uuid,
  name: apiKeysTable.name,
  key_preview: apiKeysTable.key_preview,
  created_at: apiKeysTable.created_at,
  is_active: apiKeysTable.is_active,
  user_id: apiKeysTable.user_id,
  scope: apiKeysTable.scope,
};

export class ApiKeysRepository {
  /**
   * Creates a key. The returned `key` is the only time it is available in
   * clear text: MetaMCP keeps its digest.
   */
  async create(input: z.input<typeof ApiKeyCreateInputSchema>): Promise<{
    uuid: string;
    name: string;
    key: string;
    key_preview: string;
    user_id: string | null;
    created_at: Date;
    scope: ApiKeyScope;
  }> {
    const key = generateApiKey();
    const scope = input.scope ?? "user";

    const createdApiKey = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(apiKeysTable)
        .values({
          name: input.name,
          ...storedApiKeyFields(key),
          user_id: input.user_id,
          is_active: input.is_active ?? true,
          scope,
        })
        .returning({
          uuid: apiKeysTable.uuid,
          name: apiKeysTable.name,
          key_preview: apiKeysTable.key_preview,
          user_id: apiKeysTable.user_id,
          created_at: apiKeysTable.created_at,
          scope: apiKeysTable.scope,
        });
      if (!created) {
        throw new Error("Failed to create API key");
      }
      if (scope === "endpoints" && input.endpoint_uuids?.length) {
        await tx.insert(apiKeyEndpointsTable).values(
          [...new Set(input.endpoint_uuids)].map((endpointUuid) => ({
            api_key_uuid: created.uuid,
            endpoint_uuid: endpointUuid,
          })),
        );
      }
      return created;
    });

    return {
      ...createdApiKey,
      key,
    };
  }

  async findByUserId(userId: string) {
    return await db
      .select({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
        key_preview: apiKeysTable.key_preview,
        created_at: apiKeysTable.created_at,
        is_active: apiKeysTable.is_active,
      })
      .from(apiKeysTable)
      .where(eq(apiKeysTable.user_id, userId))
      .orderBy(desc(apiKeysTable.created_at));
  }

  /**
   * Keys a caller may see and manage (see ApiKeyManagementScope), with their
   * owner and the endpoints of endpoint-scoped keys.
   */
  async list(scope: ApiKeyManagementScope): Promise<ApiKeyListItem[]> {
    const rows = await db
      .select({
        ...keyColumns,
        owner_name: usersTable.name,
        owner_email: usersTable.email,
      })
      .from(apiKeysTable)
      .leftJoin(usersTable, eq(usersTable.id, apiKeysTable.user_id))
      .where(manageableBy(scope))
      .orderBy(desc(apiKeysTable.created_at));

    const endpointsByKey = await this.endpointsOf(
      rows.filter((row) => row.scope === "endpoints").map((row) => row.uuid),
    );

    return rows.map(({ owner_name, owner_email, ...row }) => ({
      ...row,
      endpoints: endpointsByKey.get(row.uuid) ?? [],
      owner:
        row.user_id && owner_email
          ? { id: row.user_id, name: owner_name ?? "", email: owner_email }
          : null,
    }));
  }

  /** Endpoints (uuid, name) of each endpoint-scoped key. */
  private async endpointsOf(
    keyUuids: string[],
  ): Promise<Map<string, Array<{ uuid: string; name: string }>>> {
    const result = new Map<string, Array<{ uuid: string; name: string }>>();
    if (keyUuids.length === 0) return result;
    const links = await db
      .select({
        key: apiKeyEndpointsTable.api_key_uuid,
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
      })
      .from(apiKeyEndpointsTable)
      .innerJoin(
        endpointsTable,
        eq(endpointsTable.uuid, apiKeyEndpointsTable.endpoint_uuid),
      )
      .where(inArray(apiKeyEndpointsTable.api_key_uuid, keyUuids))
      .orderBy(endpointsTable.name);
    for (const link of links) {
      const list = result.get(link.key) ?? [];
      list.push({ uuid: link.uuid, name: link.name });
      result.set(link.key, list);
    }
    return result;
  }

  /** A key the caller may manage (see ApiKeyManagementScope), or undefined. */
  async findManageable(uuid: string, scope: ApiKeyManagementScope) {
    const [apiKey] = await db
      .select(keyColumns)
      .from(apiKeysTable)
      .where(and(eq(apiKeysTable.uuid, uuid), manageableBy(scope)));
    return apiKey;
  }

  async validateApiKey(key: string): Promise<{
    valid: boolean;
    user_id?: string | null;
    key_uuid?: string;
    scope?: ApiKeyScope;
    /** Endpoints of an endpoint-scoped key (scope "endpoints"). */
    endpoint_uuids?: string[];
  }> {
    const [apiKey] = await db
      .select({
        uuid: apiKeysTable.uuid,
        user_id: apiKeysTable.user_id,
        is_active: apiKeysTable.is_active,
        scope: apiKeysTable.scope,
        owner_disabled: usersTable.disabled,
      })
      .from(apiKeysTable)
      .leftJoin(usersTable, eq(usersTable.id, apiKeysTable.user_id))
      .where(eq(apiKeysTable.key_hash, hashToken(key)));

    if (!apiKey) {
      return { valid: false };
    }

    // Check if key is active
    if (!apiKey.is_active) {
      return { valid: false };
    }

    // Keys of disabled users stop working (and come back if re-enabled)
    if (apiKey.owner_disabled) {
      return { valid: false };
    }

    const endpointUuids =
      apiKey.scope === "endpoints"
        ? (
            await db
              .select({ uuid: apiKeyEndpointsTable.endpoint_uuid })
              .from(apiKeyEndpointsTable)
              .where(eq(apiKeyEndpointsTable.api_key_uuid, apiKey.uuid))
          ).map((row) => row.uuid)
        : undefined;

    return {
      valid: true,
      user_id: apiKey.user_id,
      key_uuid: apiKey.uuid,
      scope: apiKey.scope,
      ...(endpointUuids ? { endpoint_uuids: endpointUuids } : {}),
    };
  }

  async update(
    uuid: string,
    scope: ApiKeyManagementScope,
    input: ApiKeyUpdateInput,
  ) {
    return await db.transaction(async (tx) => {
      const [updatedApiKey] = await tx
        .update(apiKeysTable)
        .set({
          ...(input.name && { name: input.name }),
          ...(input.is_active !== undefined && { is_active: input.is_active }),
          ...(input.scope && { scope: input.scope }),
        })
        .where(and(eq(apiKeysTable.uuid, uuid), manageableBy(scope)))
        .returning({
          uuid: apiKeysTable.uuid,
          name: apiKeysTable.name,
          key_preview: apiKeysTable.key_preview,
          created_at: apiKeysTable.created_at,
          is_active: apiKeysTable.is_active,
          scope: apiKeysTable.scope,
        });

      if (!updatedApiKey) {
        throw new Error("Failed to update API key or API key not found");
      }

      // The endpoint list follows the scope: replaced when given, dropped
      // when the key goes back to the "user" scope.
      if (input.scope === "user" || input.endpoint_uuids) {
        await tx
          .delete(apiKeyEndpointsTable)
          .where(eq(apiKeyEndpointsTable.api_key_uuid, uuid));
      }
      if (updatedApiKey.scope === "endpoints" && input.endpoint_uuids?.length) {
        await tx.insert(apiKeyEndpointsTable).values(
          [...new Set(input.endpoint_uuids)].map((endpointUuid) => ({
            api_key_uuid: uuid,
            endpoint_uuid: endpointUuid,
          })),
        );
      }

      return updatedApiKey;
    });
  }

  async delete(uuid: string, scope: ApiKeyManagementScope) {
    const [deletedApiKey] = await db
      .delete(apiKeysTable)
      .where(and(eq(apiKeysTable.uuid, uuid), manageableBy(scope)))
      .returning({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
        user_id: apiKeysTable.user_id,
      });

    if (!deletedApiKey) {
      throw new Error("Failed to delete API key or API key not found");
    }

    return deletedApiKey;
  }
}
