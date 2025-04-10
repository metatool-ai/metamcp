import { NextResponse } from 'next/server';

import { createClient } from '@/utils/supabase/server';
// Keep schema import if needed for types, but not for table object
// import { apiKeysTable } from '@/db/schema';

import { getProjectActiveProfile } from '../actions/profiles';

export async function authenticateApiKey(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: NextResponse.json(
        { error: 'Authorization header with Bearer token is required' },
        { status: 401 }
      ),
    };
  }

  const apiKey = authHeader.substring(7).trim(); // Remove 'Bearer ' prefix
  const supabase = await createClient();
  const { data: apiKeyRecordData, error: apiKeyError } = await supabase
    .from('api_keys') // Use table name as string
    .select('*')
    .eq('api_key', apiKey)
    .limit(1)
    .maybeSingle(); // Returns single object or null

  if (apiKeyError) {
    console.error('Supabase API key fetch error:', apiKeyError);
    return {
      error: NextResponse.json(
        { error: 'Failed to verify API key' },
        { status: 500 }
      ),
    };
  }

  if (!apiKeyRecordData) {
    return {
      error: NextResponse.json({ error: 'Invalid API key' }, { status: 401 }),
    };
  }
  // Assign data to a new const for clarity if preferred
  const apiKeyRecord = apiKeyRecordData;

  const activeProfile = await getProjectActiveProfile(
    apiKeyRecord.project_uuid // Access directly from the single object
  );
  if (!activeProfile) {
    return {
      error: NextResponse.json(
        { error: 'No active profile found for this API key' },
        { status: 401 }
      ),
    };
  }

  return {
    success: true,
    apiKey: apiKeyRecord, // Return the single object
    activeProfile,
  };
}
