import {
  DatabaseEndpoint,
  DatabaseEndpointWithNamespace,
  Endpoint,
  EndpointWithNamespace,
} from "@repo/zod-types";

export class EndpointsSerializer {
  static serializeEndpoint(dbEndpoint: DatabaseEndpoint): Endpoint {
    return {
      uuid: dbEndpoint.uuid,
      name: dbEndpoint.name,
      description: dbEndpoint.description,
      namespace_uuid: dbEndpoint.namespace_uuid,
      enable_api_key_auth: dbEndpoint.enable_api_key_auth,
      enableClientMaxRate: dbEndpoint.enable_client_max_rate,
      enableMaxRate: dbEndpoint.enable_max_rate,
      maxRateSeconds:
        dbEndpoint.max_rate_seconds === null
          ? undefined
          : dbEndpoint.max_rate_seconds,
      maxRate: dbEndpoint.max_rate === null ? undefined : dbEndpoint.max_rate,
      clientMaxRate:
        dbEndpoint.client_max_rate === null
          ? undefined
          : dbEndpoint.client_max_rate,
      clientMaxRateSeconds:
        dbEndpoint.client_max_rate_seconds === null
          ? undefined
          : dbEndpoint.client_max_rate_seconds,
      clientMaxRateStrategy:
        dbEndpoint.client_max_rate_strategy === null
          ? undefined
          : dbEndpoint.client_max_rate_strategy,
      clientMaxRateStrategyKey:
        dbEndpoint.client_max_rate_strategy_key === null
          ? undefined
          : dbEndpoint.client_max_rate_strategy_key,
      enable_oauth: dbEndpoint.enable_oauth,
      use_query_param_auth: dbEndpoint.use_query_param_auth,
      created_at: dbEndpoint.created_at.toISOString(),
      updated_at: dbEndpoint.updated_at.toISOString(),
      user_id: dbEndpoint.user_id,
    };
  }

  static serializeEndpointList(dbEndpoints: DatabaseEndpoint[]): Endpoint[] {
    return dbEndpoints.map(this.serializeEndpoint);
  }

  static serializeEndpointWithNamespace(
    dbEndpoint: DatabaseEndpointWithNamespace,
  ): EndpointWithNamespace {
    return {
      uuid: dbEndpoint.uuid,
      name: dbEndpoint.name,
      description: dbEndpoint.description,
      namespace_uuid: dbEndpoint.namespace_uuid,
      enable_api_key_auth: dbEndpoint.enable_api_key_auth,
      enableClientMaxRate: dbEndpoint.enable_client_max_rate,
      enableMaxRate: dbEndpoint.enable_max_rate,
      maxRateSeconds:
        dbEndpoint.max_rate_seconds === null
          ? undefined
          : dbEndpoint.max_rate_seconds,
      maxRate: dbEndpoint.max_rate === null ? undefined : dbEndpoint.max_rate,
      clientMaxRate:
        dbEndpoint.client_max_rate === null
          ? undefined
          : dbEndpoint.client_max_rate,
      clientMaxRateSeconds:
        dbEndpoint.client_max_rate_seconds === null
          ? undefined
          : dbEndpoint.client_max_rate_seconds,
      clientMaxRateStrategy:
        dbEndpoint.client_max_rate_strategy === null
          ? undefined
          : dbEndpoint.client_max_rate_strategy,
      clientMaxRateStrategyKey:
        dbEndpoint.client_max_rate_strategy_key === null
          ? undefined
          : dbEndpoint.client_max_rate_strategy_key,
      enable_oauth: dbEndpoint.enable_oauth,
      use_query_param_auth: dbEndpoint.use_query_param_auth,
      created_at: dbEndpoint.created_at.toISOString(),
      updated_at: dbEndpoint.updated_at.toISOString(),
      user_id: dbEndpoint.user_id,
      namespace: {
        uuid: dbEndpoint.namespace.uuid,
        name: dbEndpoint.namespace.name,
        description: dbEndpoint.namespace.description,
        created_at: dbEndpoint.namespace.created_at.toISOString(),
        updated_at: dbEndpoint.namespace.updated_at.toISOString(),
        user_id: dbEndpoint.namespace.user_id,
      },
    };
  }

  static serializeEndpointWithNamespaceList(
    dbEndpoints: DatabaseEndpointWithNamespace[],
  ): EndpointWithNamespace[] {
    return dbEndpoints.map(this.serializeEndpointWithNamespace);
  }
}
