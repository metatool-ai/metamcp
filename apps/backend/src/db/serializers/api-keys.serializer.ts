export class ApiKeysSerializer {
  static serializeApiKey(dbApiKey: {
    uuid: string;
    name: string;
    key_preview: string;
    created_at: Date;
    is_active: boolean;
    scope: "user" | "endpoints";
  }) {
    return {
      uuid: dbApiKey.uuid,
      name: dbApiKey.name,
      key_preview: dbApiKey.key_preview,
      created_at: dbApiKey.created_at,
      is_active: dbApiKey.is_active,
      scope: dbApiKey.scope,
    };
  }

  /** The only response that carries the full key. */
  static serializeCreateApiKeyResponse(dbApiKey: {
    uuid: string;
    name: string;
    key: string;
    key_preview: string;
    user_id: string | null;
    created_at: Date;
  }) {
    return {
      uuid: dbApiKey.uuid,
      name: dbApiKey.name,
      key: dbApiKey.key,
      key_preview: dbApiKey.key_preview,
      created_at: dbApiKey.created_at,
    };
  }
}
