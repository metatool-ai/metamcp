import { Tool } from "@repo/zod-types";

type DatabaseTool = {
  uuid: string;
  name: string;
  description: string | null;
  toolSchema: {
    type: "object";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties?: Record<string, any>;
  };
  annotations: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
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
      toolSchema: dbTool.toolSchema,
      annotations: dbTool.annotations,
      created_at: dbTool.created_at.toISOString(),
      updated_at: dbTool.updated_at.toISOString(),
      mcp_server_uuid: dbTool.mcp_server_uuid,
    };
  }

  static serializeToolList(dbTools: DatabaseTool[]): Tool[] {
    return dbTools.map(this.serializeTool);
  }
}
