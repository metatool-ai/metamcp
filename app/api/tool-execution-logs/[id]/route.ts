import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/db';
import { toolExecutionLogsTable } from '@/db/schema';

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
    const updatedLog = await db
      .update(toolExecutionLogsTable)
      .set(updateData)
      .where(eq(toolExecutionLogsTable.id, parseInt(logId)))
      .returning();

    if (updatedLog.length === 0) {
      return NextResponse.json(
        { error: 'Tool execution log not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedLog[0]);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to update tool execution log' },
      { status: 500 }
    );
  }
}
