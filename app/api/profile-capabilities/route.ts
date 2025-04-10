import { NextResponse } from 'next/server';

import { createClient } from '@/utils/supabase/server';
// Remove unused schema import if not needed for types
// import { profilesTable } from '@/db/schema';

import { authenticateApiKey } from '../auth';

export async function GET(request: Request) {
  try {
    const auth = await authenticateApiKey(request);
    if (auth.error) return auth.error;

    const supabase = await createClient();
    const { data: profile, error: fetchError } = await supabase
      .from('profiles') // Use table name string
      .select('enabled_capabilities') // Select only the needed column
      .eq('uuid', auth.activeProfile.uuid) // Filter by active profile UUID
      .single(); // Expect a single result or null/error

    if (fetchError) {
      // Handle case where profile might not be found vs. other DB errors
      if (fetchError.code === 'PGRST116') { // Code for "Resource not found"
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      }
      console.error('Supabase profile fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch profile capabilities' },
        { status: 500 }
      );
    }

    // Check if profile data is null after handling specific errors
    if (!profile) {
      // This case might be redundant if PGRST116 is caught above, but good as a fallback
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({
      profileCapabilities: profile.enabled_capabilities, // Access directly from single object
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to fetch profile capabilities' },
      { status: 500 }
    );
  }
}
