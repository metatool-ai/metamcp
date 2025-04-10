'use server';

// Remove Drizzle imports
// import { eq } from 'drizzle-orm';

import { createClient } from '@/utils/supabase/server';
import { ProfileCapability } from '@/db/schema'; // Keep enum
// Remove unused schema imports
// import { profilesTable } from '@/db/schema';
// import { projectsTable } from '@/db/schema';

export async function createProfile(currentProjectUuid: string, name: string) {
  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from('profiles') // Use table name string
    .insert({
      name,
      project_uuid: currentProjectUuid,
    })
    .select() // Select the inserted row
    .single(); // Expect single result

  if (error || !profile) {
    console.error("Error creating profile:", error);
    throw new Error('Failed to create profile');
  }

  return profile; // Return single object
}

export async function getProfile(profileUuid: string) {
  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from('profiles') // Use table name string
    .select('*')
    .eq('uuid', profileUuid)
    .maybeSingle(); // Returns object or null

  if (error) {
    console.error(`Error fetching profile ${profileUuid}:`, error);
    throw new Error('Failed to fetch profile');
  }

  if (!profile) {
    throw new Error('Profile not found');
  }

  return profile; // Return single object
}

export async function getProfiles(currentProjectUuid: string) {
  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from('profiles') // Use table name string
    .select('*')
    .eq('project_uuid', currentProjectUuid);

  if (error) {
    console.error(`Error fetching profiles for project ${currentProjectUuid}:`, error);
    return []; // Return empty array on error
  }

  return profiles || []; // Return data or empty array
}

export async function getProjectActiveProfile(currentProjectUuid: string) {
  // --- Refactoring getProjectActiveProfile ---
  const supabase = await createClient();

  // 1. Fetch the project
  const { data: currentProject, error: projectFetchError } = await supabase
    .from('projects')
    .select('*')
    .eq('uuid', currentProjectUuid)
    .maybeSingle();

  if (projectFetchError) {
    console.error(`Error fetching project ${currentProjectUuid}:`, projectFetchError);
    throw new Error('Failed to fetch project');
  }

  if (!currentProject) {
    throw new Error('Project not found');
  }

  // (currentProject is already the single object or null)

  // Try to get active profile if set
  if (currentProject.active_profile_uuid) {
    // 2. Try fetching the currently set active profile
    const { data: activeProfile, error: activeProfileFetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('uuid', currentProject.active_profile_uuid)
      .maybeSingle();

    // Ignore fetch error here, as we'll handle the case where it's not found
    if (!activeProfileFetchError && activeProfile) {
      return activeProfile; // Return if found and valid
    }

    // (Handled above)
  }

  // If no active profile or not found, get all profiles
  // 3. If no active profile found, fetch all profiles for the project
  const { data: profiles, error: profilesFetchError } = await supabase
    .from('profiles')
    .select('*')
    .eq('project_uuid', currentProjectUuid);

  if (profilesFetchError) {
    console.error(`Error fetching profiles for project ${currentProjectUuid}:`, profilesFetchError);
    // If we can't fetch profiles, we can't proceed to set/create one
    throw new Error('Failed to fetch profiles for project');
  }

  // If there are profiles, use the first one and set it as active
  // 4. If profiles exist, set the first one as active and return it
  if (profiles && profiles.length > 0) {
    const firstProfile = profiles[0];
    const { error: updateError } = await supabase
      .from('projects')
      .update({ active_profile_uuid: firstProfile.uuid })
      .eq('uuid', currentProjectUuid);

    if (updateError) {
      console.error(`Error setting first profile active for project ${currentProjectUuid}:`, updateError);
      // Proceed to return the profile even if update fails? Or throw? Let's return it for now.
    }

    return firstProfile;
  }

  // If no profiles exist, create a default one
  // 5. If no profiles exist, create a default one
  const { data: defaultProfile, error: createError } = await supabase
    .from('profiles')
    .insert({
      name: 'Default Workspace',
      project_uuid: currentProjectUuid,
    })
    .select()
    .single();

  if (createError || !defaultProfile) {
    console.error(`Error creating default profile for project ${currentProjectUuid}:`, createError);
    throw new Error('Failed to create default profile');
  }

  // Set it as active
  // 6. Set the new default profile as active
  const { error: finalUpdateError } = await supabase
    .from('projects')
    .update({ active_profile_uuid: defaultProfile.uuid })
    .eq('uuid', currentProjectUuid);

  if (finalUpdateError) {
    console.error(`Error setting default profile active for project ${currentProjectUuid}:`, finalUpdateError);
    // Return the profile anyway? Or throw? Let's return it.
  }

  return defaultProfile;
  // --- End Refactoring getProjectActiveProfile ---
}

export async function setProfileActive(
  projectUuid: string,
  profileUuid: string
) {
  // --- Refactoring setProfileActive ---
  const supabase = await createClient();

  // Optional: Verify project exists first (could rely on FK constraint)
  const { data: project, error: projectFetchError } = await supabase
    .from('projects')
    .select('uuid')
    .eq('uuid', projectUuid)
    .maybeSingle();

  if (projectFetchError) {
    console.error(`Error checking project ${projectUuid} existence:`, projectFetchError);
    throw new Error('Failed to check project existence');
  }

  if (!project) {
    throw new Error('Project not found');
  }

  // Optional: Verify profile exists and belongs to project (could rely on FK)

  // Update the project
  const { error: updateError } = await supabase
    .from('projects')
    .update({ active_profile_uuid: profileUuid })
    .eq('uuid', projectUuid)
  if (updateError) {
    console.error(`Error setting active profile for project ${projectUuid}:`, updateError);
    // Check if error indicates project not found vs other issues
    throw new Error('Failed to set active profile');
  }
  // --- End Refactoring setProfileActive ---
}

export async function updateProfileName(profileUuid: string, newName: string) {
  // --- Refactoring updateProfileName ---
  const supabase = await createClient();
  // Verify profile exists first
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('uuid')
    .eq('uuid', profileUuid)
    .maybeSingle();

  if (fetchError) {
    console.error(`Error checking profile ${profileUuid} existence:`, fetchError);
    throw new Error('Failed to check profile existence');
  }

  if (!profile) {
    throw new Error('Profile not found');
  }

  // Perform update
  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update({ name: newName })
    .eq('uuid', profileUuid)
    .select() // Select updated row
    .single(); // Expect single result

  if (updateError || !updatedProfile) {
    console.error(`Error updating profile name ${profileUuid}:`, updateError);
    throw new Error('Failed to update profile name');
  }

  return updatedProfile; // Return single object
  // --- End Refactoring updateProfileName ---
}

export async function deleteProfile(profileUuid: string) {
  // --- Refactoring deleteProfile ---
  const supabase = await createClient();
  // No need to fetch profile first if checking count

  // Check if this is the last profile
  // Check profile count
  const { count: profileCount, error: countError } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true }); // Get count efficiently

  if (countError) {
    console.error("Error counting profiles:", countError);
    throw new Error('Failed to count profiles before deletion');
  }

  if (profileCount === 1) {
    throw new Error('Cannot delete the last profile');
  }

  // Perform delete
  const { error: deleteError } = await supabase
    .from('profiles')
    .delete()
    .eq('uuid', profileUuid);

  if (deleteError) {
    console.error(`Error deleting profile ${profileUuid}:`, deleteError);
    // Check if error indicates not found vs other issues
    throw new Error('Failed to delete profile');
  }

  return { success: true }; // Return success object
  // --- End Refactoring deleteProfile ---
}

export async function setActiveProfile(profileUuid: string) {
  // --- Refactoring setActiveProfile ---
  // This seems identical to getProfile, refactor similarly
  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from('profiles') // Use table name string
    .select('*')
    .eq('uuid', profileUuid)
    .maybeSingle(); // Returns object or null

  if (error) {
    console.error(`Error fetching profile ${profileUuid} for setActiveProfile:`, error);
    throw new Error('Failed to fetch profile');
  }

  if (!profile) {
    throw new Error('Profile not found');
  }

  return profile; // Return single object
  // --- End Refactoring setActiveProfile ---
}

export async function updateProfileCapabilities(
  profileUuid: string,
  capabilities: ProfileCapability[]
) {
  // --- Refactoring updateProfileCapabilities ---
  const supabase = await createClient();
  // Verify profile exists first
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('uuid')
    .eq('uuid', profileUuid)
    .maybeSingle();

  if (fetchError) {
    console.error(`Error checking profile ${profileUuid} existence:`, fetchError);
    throw new Error('Failed to check profile existence');
  }

  if (!profile) {
    throw new Error('Profile not found');
  }

  // Perform update
  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update({ enabled_capabilities: capabilities }) // Update capabilities array
    .eq('uuid', profileUuid)
    .select() // Select updated row
    .single(); // Expect single result

  if (updateError || !updatedProfile) {
    console.error(`Error updating profile capabilities ${profileUuid}:`, updateError);
    throw new Error('Failed to update profile capabilities');
  }

  return updatedProfile; // Return single object
  // --- End Refactoring updateProfileCapabilities ---
}
