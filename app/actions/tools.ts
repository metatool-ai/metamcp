'use server';

// Remove Drizzle imports
// import { eq } from 'drizzle-orm';

import { createClient } from '@/utils/supabase/server';
import { ToggleStatus } from '@/db/schema'; // Keep enum
// Remove unused schema import
// import { toolsTable } from '@/db/schema';
import { Tool } from '@/types/tool';

export async function getToolsByMcpServerUuid(
  mcpServerUuid: string
): Promise<Tool[]> {
  const supabase = await createClient();
  const { data: tools, error } = await supabase
    .from('tools') // Use table name string
    .select('*') // Select all columns
    .eq('mcp_server_uuid', mcpServerUuid) // Filter by server UUID
    .order('name'); // Order by name

  if (error) {
    console.error("Error fetching tools by server UUID:", error);
    return []; // Return empty array on error
  }

  return (tools || []) as Tool[]; // Return data or empty array, assert type
}

export async function toggleToolStatus(
  toolUuid: string,
  status: ToggleStatus
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('tools') // Use table name string
    .update({ status: status }) // Set the new status
    .eq('uuid', toolUuid); // Filter by tool UUID

  if (error) {
    console.error("Error updating tool status:", error);
    // Consider throwing error or handling specific cases (e.g., tool not found)
    throw new Error('Failed to update tool status');
  }
}
