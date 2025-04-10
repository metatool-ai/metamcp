import { NextResponse } from 'next/server';

import { createClient } from '@/utils/supabase/server'; // Use the server helper
import { McpServerStatus } from '@/db/schema'; // Keep enum for status check

import { authenticateApiKey } from '../auth';

export async function GET(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const supabase = await createClient(); // Use the async helper

    // Fetch active servers - profile_uuid filtering is deferred as requested
    const { data: activeMcpServers, error: fetchError } = await supabase
      .from('mcp_servers') // Use table name as string
      .select('*')
      .eq('status', McpServerStatus.ACTIVE); // Use enum value 'ACTIVE'

    if (fetchError) {
      console.error('Supabase fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch active MCP servers' },
        { status: 500 }
      );
    }

    return NextResponse.json(activeMcpServers);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to fetch active MCP servers' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const supabase = await createClient(); // Use the async helper

    const body = await request.json();
    // Ensure all relevant fields from the schema are extracted
    const { uuid, name, description, type, command, args, env, url, status } = body;

    // Insert new server - profile_uuid is omitted as requested
    const { data: newMcpServer, error: insertError } = await supabase
      .from('mcp_servers') // Use table name as string
      .insert({
        uuid, // Assuming client sends it or DB generates it
        name,
        description,
        type, // Include type from body
        command,
        args,
        env,
        url,
        status, // Use status from body
        // profile_uuid: auth.activeProfile.uuid, // Omitted as requested
      })
      .select()
      .single(); // Assuming insert returns the single created row

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to create MCP server', details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json(newMcpServer);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to create MCP server' },
      { status: 500 }
    );
  }
}
