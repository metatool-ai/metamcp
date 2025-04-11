'use server';

// Remove Drizzle imports
// import { and, desc, eq, or } from 'drizzle-orm';

import { McpServerStatus } from '@/db/schema'; // Keep enum
// Remove unused schema imports
// import { codesTable, customMcpServersTable } from '@/db/schema';
import { CustomMcpServer } from '@/types/custom-mcp-server';
import {
  CreateCustomMcpServerData,
  UpdateCustomMcpServerData,
} from '@/types/custom-mcp-server';
import { createClient } from '@/utils/supabase/server';

export async function getCustomMcpServers(profileUuid: string) {
  const supabase = await createClient();
  const { data: servers, error } = await supabase
    .from('custom_mcp_servers') // Use table name string
    .select(`
      *,
      codes!left ( code, fileName )
    `) // Select all from custom_mcp_servers and join codes
    .eq('profile_uuid', profileUuid) // Filter by profile
    .or(`status.eq.${McpServerStatus.ACTIVE},status.eq.${McpServerStatus.INACTIVE}`) // Filter status
    .order('created_at', { ascending: false }); // Order

  if (error) {
    console.error("Error fetching custom MCP servers:", error);
    return []; // Return empty array on error
  }

  // Flatten the nested codes data
  const formattedServers = servers?.map(server => {
    const codeData = Array.isArray(server.codes) && server.codes.length > 0
      ? server.codes[0]
      : server.codes; // Handle if it's already an object or null
    return {
      ...server,
      code: codeData?.code,
      codeFileName: codeData?.fileName,
      codes: undefined, // Remove nested object
    };
  });

  return (formattedServers || []) as CustomMcpServer[]; // Return formatted data or empty array
}

export async function getCustomMcpServerByUuid(
  profileUuid: string,
  uuid: string
): Promise<CustomMcpServer | null> {
  const supabase = await createClient();
  const { data: server, error } = await supabase
    .from('custom_mcp_servers') // Use table name string
    .select(`
      *,
      codes!left ( code, fileName )
    `) // Select all and join codes
    .eq('uuid', uuid)
    .eq('profile_uuid', profileUuid)
    .maybeSingle(); // Expect single or null

  if (error) {
    console.error(`Error fetching custom MCP server ${uuid}:`, error);
    return null; // Return null on error
  }

  if (!server) {
    return null; // Return null if not found
  }

  // Flatten the nested codes data before returning
  const codeData = Array.isArray(server.codes) && server.codes.length > 0
    ? server.codes[0]
    : server.codes;
  const formattedServer = {
    ...server,
    code: codeData?.code,
    codeFileName: codeData?.fileName,
    codes: undefined,
  };
  return formattedServer as CustomMcpServer;
}

export async function deleteCustomMcpServerByUuid(
  profileUuid: string,
  uuid: string
): Promise<void> {
  // Note: Original code fetched code_uuid but didn't use it. Replicating delete only.
  const supabase = await createClient();
  const { error } = await supabase
    .from('custom_mcp_servers') // Use table name string
    .delete()
    .eq('uuid', uuid)
    .eq('profile_uuid', profileUuid);

  if (error) {
    console.error(`Error deleting custom MCP server ${uuid}:`, error);
    // Handle specific errors or throw
    throw new Error('Failed to delete custom MCP server');
  }
  // No need to fetch code_uuid if not used for cascading delete etc.
}

export async function toggleCustomMcpServerStatus(
  profileUuid: string,
  uuid: string,
  newStatus: McpServerStatus
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('custom_mcp_servers') // Use table name string
    .update({ status: newStatus }) // Set the new status
    .eq('uuid', uuid)
    .eq('profile_uuid', profileUuid);

  if (error) {
    console.error(`Error toggling status for custom MCP server ${uuid}:`, error);
    // Handle specific errors or throw
    throw new Error('Failed to toggle custom MCP server status');
  }
}

export async function createCustomMcpServer(
  profileUuid: string,
  data: CreateCustomMcpServerData
) {
  const supabase = await createClient();
  const { data: server, error } = await supabase
    .from('custom_mcp_servers') // Use table name string
    .insert({
      profile_uuid: profileUuid,
      name: data.name,
      description: data.description || '',
      code_uuid: data.code_uuid,
      additionalArgs: data.additionalArgs || [],
      env: data.env || {},
      status: McpServerStatus.ACTIVE, // Default status
    })
    .select() // Select the inserted row
    .single(); // Expect single result

  if (error || !server) {
    console.error("Error creating custom MCP server:", error);
    // Handle specific errors or throw
    throw new Error('Failed to create custom MCP server');
  }

  return server;
}

export async function updateCustomMcpServer(
  profileUuid: string,
  uuid: string,
  data: UpdateCustomMcpServerData
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('custom_mcp_servers') // Use table name string
    .update({ ...data }) // Pass update data object
    .eq('uuid', uuid)
    .eq('profile_uuid', profileUuid);

  if (error) {
    console.error(`Error updating custom MCP server ${uuid}:`, error);
    // Handle specific errors or throw
    throw new Error('Failed to update custom MCP server');
  }
}
