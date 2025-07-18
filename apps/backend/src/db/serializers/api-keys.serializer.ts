import { ApiKeyType } from "@repo/zod-types";

export class ApiKeysSerializer {
  static serializeApiKey(dbApiKey: {
    uuid: string;
    name: string;
    key: string;
    type: ApiKeyType;
    created_at: Date;
    is_active: boolean;
  }) {
    return {
      uuid: dbApiKey.uuid,
      name: dbApiKey.name,
      key: dbApiKey.key,
      type: dbApiKey.type,
      created_at: dbApiKey.created_at,
      is_active: dbApiKey.is_active,
    };
  }

  static serializeApiKeyList(
    dbApiKeys: Array<{
      uuid: string;
      name: string;
      key: string;
      type: ApiKeyType;
      created_at: Date;
      is_active: boolean;
      user_id: string | null;
    }>,
  ) {
    return dbApiKeys.map((apiKey) => ({
      uuid: apiKey.uuid,
      name: apiKey.name,
      key: apiKey.key,
      type: apiKey.type,
      created_at: apiKey.created_at,
      is_active: apiKey.is_active,
      user_id: apiKey.user_id,
    }));
  }

  static serializeCreateApiKeyResponse(dbApiKey: {
    uuid: string;
    name: string;
    key: string;
    type: ApiKeyType;
    user_id: string | null;
    created_at: Date;
  }) {
    return {
      uuid: dbApiKey.uuid,
      name: dbApiKey.name,
      key: dbApiKey.key,
      type: dbApiKey.type,
      created_at: dbApiKey.created_at,
    };
  }
}
