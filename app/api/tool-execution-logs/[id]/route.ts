import { NextRequest, NextResponse } from 'next/server';

import { toolExecutionLogsTable } from '@/db/schema'; // Keep for $inferInsert type
import { createClient } from '@/utils/supabase/server';

import { authenticateApiKey } from '../../auth';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const { id: logId } = await params;

    if (!logId || isNaN(parseInt(logId))) {
      return NextResponse.json(
        { error: 'Valid log ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { result, status, error_message, execution_time_ms } = body;

    // Create update object with only the fields provided
    const updateData: Partial<typeof toolExecutionLogsTable.$inferInsert> = {};

    if (result !== undefined) updateData.result = result;
    if (status !== undefined) updateData.status = status;
    if (error_message !== undefined) updateData.error_message = error_message;
    if (execution_time_ms !== undefined)
      updateData.execution_time_ms = execution_time_ms;

    // If no fields to update, return error
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    // Update the tool execution log entry
    const supabase = await createClient();

    const { data: updatedLog, error: updateError } = await supabase
      .from('tool_execution_logs') // Use table name string
      .update(updateData) // Pass the dynamically built update object
      .eq('id', parseInt(logId)) // Filter by log ID
      .select() // Select the updated row
      .single(); // Expect a single row back

    if (updateError) {
      console.error('Supabase log update error:', updateError);
      // Handle potential errors like log not found (e.g., check error code)
      // Supabase might return an error or empty data if the row doesn't exist
      return NextResponse.json(
        { error: 'Failed to update tool execution log', details: updateError.message },
        { status: 500 } // Or 404 if error indicates not found
      );
    }

    // Check if data is null, which might indicate the log wasn't found for the given ID
    if (!updatedLog) {
      return NextResponse.json(
        { error: 'Tool execution log not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedLog); // Return the single object
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to update tool execution log' },
      { status: 500 }
    );
  }
}
