import { NextResponse } from 'next/server';

import { createClient } from '@/utils/supabase/server';
import { toolsTable } from '@/db/schema';

// Remove unused schema imports if not needed for types
// import { mcpServersTable, toolsTable } from '@/db/schema';
import { authenticateApiKey } from '../auth';

export async function POST(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { tools } = body;

    // Validate that tools is an array
    if (!Array.isArray(tools) || tools.length === 0) {
      return NextResponse.json(
        { error: 'Request must include a non-empty array of tools' },
        { status: 400 }
      );
    }

    // Validate required fields for all tools and prepare for batch insertion
    const validTools = [];
    const errors = [];

    for (const tool of tools) {
      const { name, description, toolSchema, mcp_server_uuid } = tool;

      // Validate required fields for each tool
      if (!name || !toolSchema || !mcp_server_uuid) {
        errors.push({
          tool,
          error:
            'Missing required fields: name, toolSchema, or mcp_server_uuid',
        });
        continue;
      }

      validTools.push({
        name,
        description,
        tool_schema: toolSchema, // Explicitly use snake_case for DB column
        mcp_server_uuid,
      });
    }

    // Batch insert all valid tools with upsert
    let results: any[] = [];
    if (validTools.length > 0) {
      try {
        const supabase = await createClient(); // Instantiate client
        const { data, error } = await supabase
          .from('tools') // Use table name string
          .upsert(validTools, {
            onConflict: 'mcp_server_uuid, name', // Specify conflict columns
            // ignoreDuplicates: false, // Default behavior updates conflicting rows
          })
          .select(); // Select the upserted rows

        if (error) {
          // Re-throw to be caught by the outer catch block
          throw error;
        }
        results = data || []; // Assign results, default to empty array if null
      } catch (error: any) {
        // Handle database errors for the batch operation
        console.error('Database error:', error);
        return NextResponse.json(
          {
            error: 'Failed to process tools request',
            details:
              error.code === '23503'
                ? 'One or more MCP servers not found or not associated with the active profile'
                : 'Database error occurred',
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      results,
      errors,
      success: results.length > 0,
      failureCount: errors.length,
      successCount: results.length,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to process tools request' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    // Join with mcp_servers table to filter by profile_uuid
    const supabase = await createClient();

    // Build the query using Supabase client
    let queryBuilder = supabase
      .from('tools')
      .select(`
        mcp_server_uuid,
        name,
        status,
        mcp_servers!inner ( profile_uuid )
      `) // Select columns and enforce inner join
      .eq('mcp_servers.profile_uuid', auth.activeProfile.uuid); // Filter by profile_uuid via join

    // Conditionally add status filter
    if (status) {
      queryBuilder = queryBuilder.eq('status', status);
    }

    const { data: results, error: fetchError } = await queryBuilder;

    if (fetchError) {
      console.error('Supabase tools fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch tools' },
        { status: 500 }
      );
    }

    // The result structure includes nested mcp_servers. Flatten if needed.
    const formattedResults = results?.map(tool => ({
      mcp_server_uuid: tool.mcp_server_uuid,
      name: tool.name,
      status: tool.status,
      // mcp_servers object is implicitly filtered but not needed in output here
    }));

    return NextResponse.json({ results: formattedResults || [] });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to fetch tools' },
      { status: 500 }
    );
  }
}
