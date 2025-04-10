import { NextResponse } from 'next/server';

import { createClient } from '@/utils/supabase/server';
import { ToolExecutionStatus } from '@/db/schema'; // Keep enum for status
// Remove unused schema table imports if not needed for types
// import { mcpServersTable, toolExecutionLogsTable } from '@/db/schema';

import { authenticateApiKey } from '../auth';

export async function POST(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const {
      mcp_server_uuid,
      tool_name,
      payload,
      result,
      status,
      error_message,
      execution_time_ms,
    } = body;

    // Validate required fields
    if (!tool_name) {
      return NextResponse.json(
        { error: 'Tool name is required' },
        { status: 400 }
      );
    }

    // If mcp_server_uuid is provided, verify it belongs to the authenticated user's active profile
    if (mcp_server_uuid) {
      const supabase = await createClient(); // Create client here if not already done
      const { data: mcpServer, error: serverFetchError } = await supabase
        .from('mcp_servers') // Use table name string
        .select('uuid') // Only need to select something to check existence
        .eq('uuid', mcp_server_uuid)
        .eq('profile_uuid', auth.activeProfile.uuid)
        .limit(1)
        .maybeSingle(); // Returns the server object or null

      if (serverFetchError) {
        console.error('Supabase MCP server fetch error:', serverFetchError);
        return NextResponse.json(
          { error: 'Failed to verify MCP server' },
          { status: 500 }
        );
      }

      if (!mcpServer) { // Check if null
        return NextResponse.json(
          { error: 'MCP server not found or does not belong to your profile' },
          { status: 404 }
        );
      }
    }

    // Create new tool execution log entry
    // Ensure supabase client is instantiated if validation wasn't needed
    const supabase = await createClient();

    const { data: newToolExecutionLog, error: insertError } = await supabase
      .from('tool_execution_logs') // Use table name string
      .insert({
        mcp_server_uuid: mcp_server_uuid || null, // Handle null case
        tool_name,
        payload: payload || {}, // Handle default empty object
        result: result || null, // Handle null case
        status: status || ToolExecutionStatus.PENDING, // Handle default status
        error_message: error_message || null, // Handle null case
        execution_time_ms: execution_time_ms || null, // Handle null case
      })
      .select() // Select the inserted row
      .single(); // Expect a single row

    if (insertError) {
      console.error('Supabase log insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to create tool execution log', details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json(newToolExecutionLog); // Return the single object
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to create tool execution log' },
      { status: 500 }
    );
  }
}
