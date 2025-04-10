import { NextResponse } from 'next/server';

import { createClient } from '@/utils/supabase/server';
import { McpServerStatus } from '@/db/schema'; // Keep enum for status values

import { authenticateApiKey } from '../auth';

export async function GET(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const supabase = await createClient();

    // Replicate select with join, filter, and order
    const { data: customMcpServers, error: fetchError } = await supabase
      .from('custom_mcp_servers') // Use table name string
      .select(`
        uuid,
        name,
        description,
        code_uuid,
        additionalArgs,
        env,
        created_at,
        profile_uuid,
        status,
        codes ( code, fileName )
      `) // Select columns and join codes table
      .eq('profile_uuid', auth.activeProfile.uuid) // Filter by profile_uuid
      .or(`status.eq.${McpServerStatus.ACTIVE},status.eq.${McpServerStatus.INACTIVE}`) // Filter by status (ACTIVE or INACTIVE)
      .order('created_at', { ascending: false }); // Order by created_at descending

    if (fetchError) {
      console.error('Supabase fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch custom MCP servers' },
        { status: 500 }
      );
    }

    // The result structure might differ slightly (codes nested). Adjust if needed.
    // Example transformation to flatten the nested 'codes' object/array
    const formattedServers = customMcpServers?.map(server => {
      // Check if codes exists and is an array with at least one element
      const codeData = Array.isArray(server.codes) && server.codes.length > 0
        ? server.codes[0]
        : null; // Or handle as needed if it could be a single object

      return {
        ...server,
        code: codeData?.code, // Access code from the first element
        codeFileName: codeData?.fileName, // Access fileName from the first element
        codes: undefined, // Remove the nested object/array
      };
    });

    return NextResponse.json(formattedServers || []); // Return formatted data or empty array
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to fetch custom MCP servers' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { name, description, code_uuid, additionalArgs, env } = body;

    const supabase = await createClient();

    const { data: newCustomMcpServer, error: insertError } = await supabase
      .from('custom_mcp_servers') // Use table name string
      .insert({
        name,
        description,
        code_uuid,
        additionalArgs,
        env,
        status: McpServerStatus.ACTIVE, // Set status explicitly
        profile_uuid: auth.activeProfile.uuid, // Include profile_uuid
      })
      .select() // Select the inserted row
      .single(); // Expect a single row back

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to create custom MCP server', details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json(newCustomMcpServer); // Return the single object
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to create custom MCP server' },
      { status: 500 }
    );
  }
}
