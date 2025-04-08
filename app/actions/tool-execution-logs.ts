'use server';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  mcpServersTable,
  toolExecutionLogsTable,
  ToolExecutionStatus,
} from '@/db/schema';

export type ToolExecutionLog = {
  id: number;
  mcp_server_uuid: string | null;
  tool_name: string;
  payload: Record<string, any>;
  result: any;
  status: ToolExecutionStatus;
  error_message: string | null;
  execution_time_ms: string | null;
  created_at: Date;
  mcp_server_name?: string;
};

type GetToolExecutionLogsOptions = {
  limit?: number;
  offset?: number;
  mcpServerUuids?: string[];
  toolNames?: string[];
  statuses?: ToolExecutionStatus[];
  currentProfileUuid: string;
};

export async function getToolExecutionLogs({
  limit = 50,
  offset = 0,
  mcpServerUuids,
  toolNames,
  statuses,
  currentProfileUuid,
}: GetToolExecutionLogsOptions): Promise<{
  logs: ToolExecutionLog[];
  total: number;
}> {
  // Return early if no profile UUID is provided
  if (!currentProfileUuid) {
    return { logs: [], total: 0 };
  }

  // Build the where conditions
  const whereConditions = [];

  // Filter by MCP servers that belong to the current profile
  const allowedMcpServers = await db
    .select({ uuid: mcpServersTable.uuid })
    .from(mcpServersTable)
    .where(eq(mcpServersTable.profile_uuid, currentProfileUuid));

  const allowedMcpServerUuids = allowedMcpServers.map((server) => server.uuid);

  if (allowedMcpServerUuids.length > 0) {
    whereConditions.push(
      inArray(toolExecutionLogsTable.mcp_server_uuid, allowedMcpServerUuids)
    );
  }

  // Apply additional filters if provided
  if (mcpServerUuids && mcpServerUuids.length > 0) {
    whereConditions.push(
      inArray(toolExecutionLogsTable.mcp_server_uuid, mcpServerUuids)
    );
  }

  if (toolNames && toolNames.length > 0) {
    whereConditions.push(inArray(toolExecutionLogsTable.tool_name, toolNames));
  }

  if (statuses && statuses.length > 0) {
    whereConditions.push(inArray(toolExecutionLogsTable.status, statuses));
  }

  // Combine all conditions with AND
  const whereClause =
    whereConditions.length > 0 ? and(...whereConditions) : undefined;

  // Get total count
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(toolExecutionLogsTable)
    .where(whereClause);

  // Get logs with joined MCP server names
  const logs = await db
    .select({
      id: toolExecutionLogsTable.id,
      mcp_server_uuid: toolExecutionLogsTable.mcp_server_uuid,
      tool_name: toolExecutionLogsTable.tool_name,
      payload: toolExecutionLogsTable.payload,
      result: toolExecutionLogsTable.result,
      status: toolExecutionLogsTable.status,
      error_message: toolExecutionLogsTable.error_message,
      execution_time_ms: toolExecutionLogsTable.execution_time_ms,
      created_at: toolExecutionLogsTable.created_at,
      mcp_server_name: mcpServersTable.name,
    })
    .from(toolExecutionLogsTable)
    .leftJoin(
      mcpServersTable,
      eq(toolExecutionLogsTable.mcp_server_uuid, mcpServersTable.uuid)
    )
    .where(whereClause)
    .orderBy(desc(toolExecutionLogsTable.id))
    .limit(limit)
    .offset(offset);

  return {
    logs: logs.map((log) => ({
      ...log,
      mcp_server_name: log.mcp_server_name || 'Unknown Server',
    })) as ToolExecutionLog[],
    total: count,
  };
}

export async function getToolNames(
  currentProfileUuid: string
): Promise<string[]> {
  // Return empty array if profile UUID is empty
  if (!currentProfileUuid) {
    return [];
  }

  // Get allowed MCP servers
  const allowedMcpServers = await db
    .select({ uuid: mcpServersTable.uuid })
    .from(mcpServersTable)
    .where(eq(mcpServersTable.profile_uuid, currentProfileUuid));

  const allowedMcpServerUuids = allowedMcpServers.map((server) => server.uuid);

  if (allowedMcpServerUuids.length === 0) {
    return [];
  }

  // Get unique tool names
  const result = await db
    .selectDistinct({ tool_name: toolExecutionLogsTable.tool_name })
    .from(toolExecutionLogsTable)
    .where(
      inArray(toolExecutionLogsTable.mcp_server_uuid, allowedMcpServerUuids)
    )
    .orderBy(toolExecutionLogsTable.tool_name);

  return result.map((r) => r.tool_name);
}
