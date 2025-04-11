'use server';

// Remove Drizzle imports
// import { and, eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';

// Remove unused schema import
// import { apiKeysTable } from '@/db/schema';
import { ApiKey } from '@/types/api-key';
import { createClient } from '@/utils/supabase/server';

const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  64
);

export async function createApiKey(projectUuid: string, name?: string) {
  const newApiKey = `sk_mt_${nanoid(64)}`;

  const supabase = await createClient();
  const { data: apiKey, error } = await supabase
    .from('api_keys') // Use table name string
    .insert({
      project_uuid: projectUuid,
      api_key: newApiKey,
      name,
    })
    .select() // Select the inserted row
    .single(); // Expect single result

  if (error) {
    console.error("Error creating API key:", error);
    // Handle specific errors or throw
    throw new Error('Failed to create API key');
  }

  return apiKey as ApiKey; // Return single object, assert type
}

export async function getFirstApiKey(projectUuid: string) {
  if (!projectUuid) {
    return null;
  }

  const supabase = await createClient();
  // eslint-disable-next-line prefer-const -- apiKey needs to be let, but fetchError doesn't change
  let { data: apiKey, error: fetchError } = await supabase
    .from('api_keys') // Use table name string
    .select('*')
    .eq('project_uuid', projectUuid)
    .limit(1) // Ensure only one is fetched if multiple exist (though shouldn't)
    .maybeSingle(); // Returns object or null

  if (fetchError) {
    console.error("Error fetching first API key:", fetchError);
    return null; // Return null on error
  }

  if (!apiKey) {
    const newApiKeyString = `sk_mt_${nanoid(64)}`;
    const { data: newlyCreatedApiKey, error: insertError } = await supabase
      .from('api_keys')
      .insert({
        project_uuid: projectUuid,
        api_key: newApiKeyString,
        // name is omitted, will use DB default if set, otherwise null
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating fallback API key:", insertError);
      return null; // Return null if creation fails
    }
    apiKey = newlyCreatedApiKey; // Assign the newly created key
  }

  return apiKey as ApiKey;
}

export async function getProjectApiKeys(projectUuid: string) {
  const supabase = await createClient(); // Instantiate client if not already done
  const { data: apiKeys, error } = await supabase
    .from('api_keys') // Use table name string
    .select('*')
    .eq('project_uuid', projectUuid);

  if (error) {
    console.error("Error fetching project API keys:", error);
    return []; // Return empty array on error
  }

  return (apiKeys || []) as ApiKey[]; // Return data or empty array, assert type
}

export async function deleteApiKey(projectUuid: string, apiKeyUuid: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('api_keys') // Use table name string
    .delete()
    .eq('uuid', apiKeyUuid)
    .eq('project_uuid', projectUuid);

  if (error) {
    console.error(`Error deleting API key ${apiKeyUuid}:`, error);
    // Handle specific errors or throw
    throw new Error('Failed to delete API key');
  }
}
