import { DatabaseMcpServer, McpServer } from "@repo/zod-types";

export class McpServersSerializer {
  static serializeMcpServer(dbServer: DatabaseMcpServer): McpServer {
    return {
      uuid: dbServer.uuid,
      name: dbServer.name,
      description: dbServer.description,
      type: dbServer.type,
      command: dbServer.command,
      args: dbServer.args,
      env: dbServer.env,
      url: dbServer.url,
      error_status: dbServer.error_status,
      created_at: dbServer.created_at.toISOString(),
      bearerToken: dbServer.bearerToken,
      user_id: dbServer.user_id,
    };
  }

  static serializeMcpServerList(dbServers: DatabaseMcpServer[]): McpServer[] {
    return dbServers.map(this.serializeMcpServer);
  }
}
