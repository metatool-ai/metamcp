'use server';

// Remove Drizzle imports
// import { and, desc, eq, or } from 'drizzle-orm';

import { McpServerStatus, McpServerType } from '@/db/schema'; // Keep enums
// Remove unused schema import
// import { mcpServersTable } from '@/db/schema';
import { McpServer } from '@/types/mcp-server';
import { createClient } from '@/utils/supabase/server';

export async function getMcpServers(
  profileUuid: string,
  status?: McpServerStatus
) {
  // Return empty array if profile UUID is empty
  if (!profileUuid) {
    return [];
  }

  const supabase = await createClient();
  let query = supabase
    .from('mcp_servers') // Use table name string
    .select('*')
    .eq('profile_uuid', profileUuid); // Filter by profile

  // Apply status filter
  if (status) {
    query = query.eq('status', status);
  } else {
    // Default to ACTIVE or INACTIVE if no specific status is provided
    query = query.or(`status.eq.${McpServerStatus.ACTIVE},status.eq.${McpServerStatus.INACTIVE}`);
  }

  const { data: servers, error } = await query.order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching MCP servers:", error);
    return []; // Return empty array on error
  }

  return (servers || []) as McpServer[]; // Return data or empty array, assert type
}

export async function getMcpServerByUuid(
  profileUuid: string,
  uuid: string
): Promise<McpServer | undefined> {
  const supabase = await createClient();
  const { data: server, error } = await supabase
    .from('mcp_servers') // Use table name string
    .select('*')
    .eq('uuid', uuid)
    .eq('profile_uuid', profileUuid)
    .maybeSingle(); // Expect single or null

  if (error) {
    console.error(`Error fetching MCP server ${uuid}:`, error);
    return undefined; // Return undefined on error
  }
  return server;
}

export async function deleteMcpServerByUuid(
  profileUuid: string,
  uuid: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('mcp_servers') // Use table name string
    .delete()
    .eq('uuid', uuid)
    .eq('profile_uuid', profileUuid);

  if (error) {
    console.error(`Error deleting MCP server ${uuid}:`, error);
    // Handle specific errors (e.g., not found) or throw
    throw new Error('Failed to delete MCP server');
  }
}

export async function toggleMcpServerStatus(
  profileUuid: string,
  uuid: string,
  newStatus: McpServerStatus
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('mcp_servers') // Use table name string
    .update({ status: newStatus }) // Set the new status
    .eq('uuid', uuid)
    .eq('profile_uuid', profileUuid);

  if (error) {
    console.error(`Error toggling status for MCP server ${uuid}:`, error);
    // Handle specific errors or throw
    throw new Error('Failed to toggle MCP server status');
  }
}

export async function updateMcpServer(
  profileUuid: string,
  uuid: string,
  data: {
    name?: string;
    description?: string;
    command?: string;
    args?: string[];
    env?: { [key: string]: string };
    url?: string;
    type?: McpServerType;
  }
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('mcp_servers') // Use table name string
    .update({ ...data }) // Pass the update data object
    .eq('uuid', uuid)
    .eq('profile_uuid', profileUuid);

  if (error) {
    console.error(`Error updating MCP server ${uuid}:`, error);
    // Handle specific errors or throw
    throw new Error('Failed to update MCP server');
  }
}

export async function createMcpServer(
  profileUuid: string,
  data: {
    name: string;
    description: string;
    command?: string;
    args: string[];
    env: { [key: string]: string };
    url?: string;
    type?: McpServerType;
  }
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('mcp_servers') // Use table name string
    .insert({
      ...data,
      profile_uuid: profileUuid, // Ensure profile_uuid is included
    });

  if (error) {
    console.error("Error creating MCP server:", error);
    // Handle specific errors or throw
    throw new Error('Failed to create MCP server');
  }
}

export async function bulkImportMcpServers(
  data: {
    mcpServers: {
      [name: string]: {
        command?: string;
        args?: string[];
        env?: { [key: string]: string };
        description?: string;
        url?: string;
        type?: McpServerType;
      };
    };
  },
  profileUuid?: string | null
) {
  if (!profileUuid) {
    throw new Error('Current workspace not found');
  }

  const { mcpServers } = data;

  const serverEntries = Object.entries(mcpServers);

  const serversToInsert = serverEntries.map(([name, serverConfig]) => ({
    name,
    description: serverConfig.description || '',
    command: serverConfig.command || null,
    args: serverConfig.args || [],
    env: serverConfig.env || {},
    url: serverConfig.url || null,
    type: serverConfig.type || McpServerType.STDIO,
    profile_uuid: profileUuid,
    status: McpServerStatus.ACTIVE,
  }));

  if (serversToInsert.length > 0) {
    const supabase = await createClient();
    const { error } = await supabase
      .from('mcp_servers') // Use table name string
      .insert(serversToInsert); // Batch insert

    if (error) {
      console.error("Error bulk importing MCP servers:", error);
      // Handle specific errors or throw
      throw new Error('Failed to bulk import MCP servers');
    }
  }

  return { success: true, count: serverEntries.length };
}
