'use server';

// Remove Drizzle imports
// import { desc, eq } from 'drizzle-orm';

import { createClient } from '@/utils/supabase/server';
// Remove unused schema import
// import { codesTable } from '@/db/schema';

export async function getCodes() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('codes') // Use table name string
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching codes:", error);
    return []; // Return empty array on error
  }
  return data || [];
}

export async function getCode(uuid: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('codes') // Use table name string
    .select('*')
    .eq('uuid', uuid)
    .single(); // Expect single result or null/error

  if (error) {
    console.error(`Error fetching code ${uuid}:`, error);
    // Handle specific errors like not found (PGRST116) if needed
    return null; // Return null on error
  }
  return data;
}

export async function createCode(fileName: string, code: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('codes') // Use table name string
    .insert({
      fileName,
      code,
    })
    .select() // Select the inserted row
    .single(); // Expect single result

  if (error) {
    console.error("Error creating code:", error);
    // Handle specific errors (e.g., constraints) if needed
    return null; // Return null on error
  }
  return data;
}

export async function updateCode(uuid: string, fileName: string, code: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('codes') // Use table name string
    .update({
      fileName,
      code,
    })
    .eq('uuid', uuid) // Filter by UUID
    .select() // Select the updated row
    .single(); // Expect single result

  if (error) {
    console.error(`Error updating code ${uuid}:`, error);
    // Handle specific errors (e.g., not found) if needed
    return null; // Return null on error
  }
  return data;
}

export async function deleteCode(uuid: string) {
  const supabase = await createClient();
  // Supabase delete doesn't typically return the deleted row by default in V2 JS client
  // We select it first to return it, or just perform delete and return success/failure

  // Option 1: Delete and return nothing or boolean
  // const { error } = await supabase
  //   .from('codes')
  //   .delete()
  //   .eq('uuid', uuid);
  // if (error) {
  //   console.error(`Error deleting code ${uuid}:`, error);
  //   return false; // Indicate failure
  // }
  // return true; // Indicate success

  // Option 2: Select then delete (if returning the deleted item is important)
  const { data: existingCode, error: fetchError } = await supabase
    .from('codes')
    .select('*')
    .eq('uuid', uuid)
    .single();

  if (fetchError || !existingCode) {
    console.error(`Error finding code ${uuid} to delete:`, fetchError);
    return null; // Indicate not found or error
  }

  const { error: deleteError } = await supabase
    .from('codes')
    .delete()
    .eq('uuid', uuid);

  if (deleteError) {
    console.error(`Error deleting code ${uuid}:`, deleteError);
    return null; // Indicate delete failed
  }

  return existingCode; // Return the data of the deleted code
}
