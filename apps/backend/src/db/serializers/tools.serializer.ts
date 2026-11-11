import { Tool } from "@repo/zod-types";

type DatabaseTool = {
  uuid: string;
  name: string;
  description: string | null;
  annotations?: Record<string, unknown> | null;
  toolSchema: {
    type: "object";
    [key: string]: unknown;
  };
  created_at: Date;
  updated_at: Date;
  mcp_server_uuid: string;
};

export class ToolsSerializer {
  static serializeTool(dbTool: DatabaseTool): Tool {
    return {
      uuid: dbTool.uuid,
      name: dbTool.name,
      description: dbTool.description,
      annotations: dbTool.annotations ?? undefined,
      toolSchema: dbTool.toolSchema,
      created_at: dbTool.created_at.toISOString(),
      updated_at: dbTool.updated_at.toISOString(),
      mcp_server_uuid: dbTool.mcp_server_uuid,
    };
  }

  static serializeToolList(dbTools: DatabaseTool[]): Tool[] {
    return dbTools.map(this.serializeTool);
  }
}
