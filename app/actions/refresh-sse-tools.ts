'use server';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
// Remove drizzle imports
// import { eq } from 'drizzle-orm';
// import { sql } from 'drizzle-orm';

import { createClient } from '@/utils/supabase/server';
import { McpServerType } from '@/db/schema'; // Keep enum
// Remove unused schema imports
// import { mcpServersTable } from '@/db/schema';
// import { toolsTable } from '@/db/schema';

// Helper function to transform localhost URLs for Docker
function transformUrlForDocker(url: string): string {
  if (
    (process.env.USE_DOCKER_HOST ?? 'true') === 'true' &&
    url.includes('localhost')
  ) {
    return url.replace('localhost', 'host.docker.internal');
  }
  return url;
}

export async function refreshSseTools(mcpServerUuid: string) {
  const supabase = await createClient();
  const { data: mcpServer, error: serverFetchError } = await supabase
    .from('mcp_servers') // Use table name string
    .select('*') // Select all columns needed
    .eq('uuid', mcpServerUuid)
    .single(); // Expect a single server or null/error

  if (serverFetchError) {
    console.error("Error fetching MCP server:", serverFetchError);
    // Rethrow or handle specific errors like not found
    if (serverFetchError.code === 'PGRST116') {
      throw new Error('MCP server not found');
    }
    throw new Error('Failed to fetch MCP server');
  }

  if (!mcpServer) {
    throw new Error('MCP server not found');
  }

  if (mcpServer.type !== McpServerType.SSE) {
    throw new Error('MCP server is not an SSE server');
  }

  if (!mcpServer.url) {
    throw new Error('MCP server URL is not set');
  }

  const transformedUrl = transformUrlForDocker(mcpServer.url);
  const transport = new SSEClientTransport(new URL(transformedUrl));

  const client = new Client(
    {
      name: 'metamcp-refresh-tools-client',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  await client.connect(transport);

  const { tools } = await client.listTools();

  // Format tools for database insertion
  const toolsToInsert = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    toolSchema: tool.inputSchema,
    mcp_server_uuid: mcpServer.uuid,
  }));

  if (toolsToInsert.length > 0) {
    // Batch insert all tools with upsert
    // Use Supabase upsert
    const { data: results, error: upsertError } = await supabase
      .from('tools') // Use table name string
      .upsert(toolsToInsert, {
        onConflict: 'mcp_server_uuid, name', // Specify conflict columns
      })
      .select(); // Select the upserted rows

    if (upsertError) {
      console.error("Error upserting tools:", upsertError);
      // Handle specific errors if needed (e.g., foreign key violation)
      throw new Error('Failed to upsert tools');
    }

    return { success: true, count: results?.length || 0, tools: results || [] };
  }

  return { success: true, count: 0, tools: [] };
}
