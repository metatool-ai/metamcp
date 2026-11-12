import {
  DatabaseNamespace,
  DatabaseNamespaceTool,
  DatabaseNamespaceWithServers,
  Namespace,
  NamespaceTool,
  NamespaceWithServers,
} from "@repo/zod-types";

import { redactServerSecrets } from "../../lib/access-control";

export class NamespacesSerializer {
  static serializeNamespace(dbNamespace: DatabaseNamespace): Namespace {
    return {
      uuid: dbNamespace.uuid,
      name: dbNamespace.name,
      description: dbNamespace.description,
      created_at: dbNamespace.created_at.toISOString(),
      updated_at: dbNamespace.updated_at.toISOString(),
      user_id: dbNamespace.user_id,
    };
  }

  static serializeNamespaceList(
    dbNamespaces: DatabaseNamespace[],
  ): Namespace[] {
    return dbNamespaces.map(this.serializeNamespace);
  }

  /**
   * @param canSeeSecrets decides, per server owner, whether env, bearerToken
   *   and header values are returned. Omit to return them unredacted (only
   *   for trusted internal callers).
   */
  static serializeNamespaceWithServers(
    dbNamespace: DatabaseNamespaceWithServers,
    canSeeSecrets?: (ownerId: string | null) => boolean,
  ): NamespaceWithServers {
    return {
      uuid: dbNamespace.uuid,
      name: dbNamespace.name,
      description: dbNamespace.description,
      created_at: dbNamespace.created_at.toISOString(),
      updated_at: dbNamespace.updated_at.toISOString(),
      user_id: dbNamespace.user_id,
      servers: dbNamespace.servers.map((server) => {
        const serialized = {
          uuid: server.uuid,
          name: server.name,
          description: server.description,
          type: server.type,
          command: server.command,
          args: server.args || [],
          url: server.url,
          env: server.env || {},
          bearerToken: server.bearerToken,
          headers: server.headers || {},
          forward_headers: server.forward_headers || {},
          error_status: server.error_status,
          created_at: server.created_at.toISOString(),
          user_id: server.user_id,
          status: server.status,
        };
        return !canSeeSecrets || canSeeSecrets(server.user_id)
          ? serialized
          : redactServerSecrets(serialized);
      }),
    };
  }

  static serializeNamespaceTool(dbTool: DatabaseNamespaceTool): NamespaceTool {
    return {
      uuid: dbTool.uuid,
      name: dbTool.name,
      description: dbTool.description,
      toolSchema: dbTool.toolSchema,
      created_at: dbTool.created_at.toISOString(),
      updated_at: dbTool.updated_at.toISOString(),
      mcp_server_uuid: dbTool.mcp_server_uuid,
      status: dbTool.status,
      serverName: dbTool.serverName,
      serverUuid: dbTool.serverUuid,
      overrideName: dbTool.overrideName,
      overrideTitle: dbTool.overrideTitle,
      overrideDescription: dbTool.overrideDescription,
      overrideAnnotations: dbTool.overrideAnnotations,
    };
  }

  static serializeNamespaceTools(
    dbTools: DatabaseNamespaceTool[],
  ): NamespaceTool[] {
    return dbTools.map(this.serializeNamespaceTool);
  }
}
