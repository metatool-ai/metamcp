'use server';

// Remove Drizzle imports
// import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { ToolExecutionStatus } from '@/db/schema'; // Keep enum
import { createClient } from '@/utils/supabase/server';
// Remove unused schema table imports
// import { mcpServersTable, toolExecutionLogsTable } from '@/db/schema';

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
  // const whereConditions = []; // Removed unused variable

  // Filter by MCP servers that belong to the current profile
  const supabase = await createClient();

  // Fetch allowed MCP server UUIDs
  const { data: allowedMcpServers, error: serverFetchError } = await supabase
    .from('mcp_servers')
    .select('uuid')
    .eq('profile_uuid', currentProfileUuid);

  if (serverFetchError) {
    console.error("Error fetching allowed MCP servers:", serverFetchError);
    return { logs: [], total: 0 }; // Return empty on error
  }

  const allowedMcpServerUuids = allowedMcpServers.map((server) => server.uuid);

  // If no allowed servers, return empty immediately
  if (!allowedMcpServerUuids || allowedMcpServerUuids.length === 0) {
    return { logs: [], total: 0 };
  }

  // Start building the Supabase query
  let logQuery = supabase
    .from('tool_execution_logs')
    .select('*, mcp_servers ( name )', { count: 'exact' }) // Select logs, join server name, get exact count
    .in('mcp_server_uuid', allowedMcpServerUuids); // Filter by allowed servers

  // Apply additional filters if provided
  // Apply additional filters conditionally
  if (mcpServerUuids && mcpServerUuids.length > 0) {
    // Intersect with allowed servers if necessary, though filtering by allowedMcpServerUuids should suffice
    // For simplicity, we assume mcpServerUuids is a subset of allowed ones or apply .in() again
    logQuery = logQuery.in('mcp_server_uuid', mcpServerUuids);
  }
  if (toolNames && toolNames.length > 0) {
    logQuery = logQuery.in('tool_name', toolNames);
  }
  if (statuses && statuses.length > 0) {
    logQuery = logQuery.in('status', statuses);
  }

  // Get total count
  // Apply ordering and pagination
  logQuery = logQuery
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);

  // Execute the query
  const { data: logs, error: logFetchError, count } = await logQuery;

  if (logFetchError) {
    console.error("Error fetching tool execution logs:", logFetchError);
    return { logs: [], total: 0 }; // Return empty on error
  }

  return {
    logs: logs.map((log) => ({
      ...log,
      // Access nested server name correctly
      mcp_server_name: log.mcp_servers?.name || 'Unknown Server',
      mcp_servers: undefined, // Remove nested object after extracting name
    })) as ToolExecutionLog[],
    total: count || 0, // Use the count from the Supabase response
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
  const supabase = await createClient();

  // Fetch allowed MCP server UUIDs
  const { data: allowedMcpServers, error: serverFetchError } = await supabase
    .from('mcp_servers')
    .select('uuid')
    .eq('profile_uuid', currentProfileUuid);

  if (serverFetchError) {
    console.error("Error fetching allowed MCP servers for tool names:", serverFetchError);
    return []; // Return empty on error
  }

  const allowedMcpServerUuids = allowedMcpServers.map((server) => server.uuid);

  if (!allowedMcpServerUuids || allowedMcpServerUuids.length === 0) {
    return [];
  }

  // Get unique tool names
  // Fetch all tool names for the allowed servers
  const { data: toolNameResults, error: toolNameFetchError } = await supabase
    .from('tool_execution_logs')
    .select('tool_name')
    .in('mcp_server_uuid', allowedMcpServerUuids);

  if (toolNameFetchError) {
    console.error("Error fetching tool names:", toolNameFetchError);
    return []; // Return empty on error
  }

  // Deduplicate and sort in code
  const distinctToolNames = [
    ...new Set(toolNameResults?.map((r) => r.tool_name) || []),
  ].sort();

  return distinctToolNames;
}
