'use server';

// Remove Drizzle imports
// import { eq } from 'drizzle-orm';

import { createClient } from '@/utils/supabase/server';
// Remove unused schema imports
// import { profilesTable, projectsTable } from '@/db/schema';

export async function createProject(name: string) {
  // Note: Supabase client doesn't support transactions like Drizzle.
  // This is refactored as sequential operations. Consider using a DB function (RPC) for atomicity.
  const supabase = await createClient();

  // 1. Create the project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({ name, active_profile_uuid: null }) // Insert with null profile initially
    .select()
    .single();

  if (projectError || !project) {
    console.error("Error creating project:", projectError);
    throw new Error('Failed to create project');
  }

  // 2. Create the default profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({ name: 'Default Workspace', project_uuid: project.uuid })
    .select()
    .single();

  if (profileError || !profile) {
    console.error("Error creating default profile:", profileError);
    // Attempt to clean up the created project if profile creation fails? (Complex without transactions)
    // For now, just throw an error.
    throw new Error('Failed to create default profile for project');
  }

  // 3. Update the project with the profile UUID
  const { data: updatedProject, error: updateError } = await supabase
    .from('projects')
    .update({ active_profile_uuid: profile.uuid })
    .eq('uuid', project.uuid)
    .select()
    .single();

  if (updateError || !updatedProject) {
    console.error("Error updating project with profile UUID:", updateError);
    // Attempt cleanup?
    throw new Error('Failed to link profile to project');
  }

  return updatedProject;
}

export async function getProject(projectUuid: string) {
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from('projects') // Use table name string
    .select('*')
    .eq('uuid', projectUuid)
    .maybeSingle(); // Returns object or null

  if (error) {
    console.error(`Error fetching project ${projectUuid}:`, error);
    throw new Error('Failed to fetch project'); // Throw error on DB failure
  }

  if (!project) {
    throw new Error('Project not found'); // Throw error if null (not found)
  }

  return project; // Return the single object
}

export async function getProjects() {
  const supabase = await createClient();
  let { data: projects, error } = await supabase
    .from('projects') // Use table name string
    .select('*');

  if (error) {
    console.error("Error fetching projects:", error);
    // Decide how to handle - throw, or return empty? Original created one.
    // Let's try creating one as fallback, mimicking original logic.
    projects = [];
  }

  // Ensure projects is an array even if fetch failed slightly differently
  if (!Array.isArray(projects)) {
    projects = [];
  }

  if (projects.length === 0) {
    try {
      const defaultProject = await createProject('Default Project'); // Call refactored createProject
      projects = [defaultProject];
    } catch (createError) {
      console.error("Error creating default project:", createError);
      // If default creation fails, return empty array or re-throw?
      return []; // Return empty if default creation fails
    }
  }

  return projects;
}

export async function updateProjectName(projectUuid: string, newName: string) {
  // Fetch first to ensure it exists before updating
  const supabase = await createClient();
  const { data: project, error: fetchError } = await supabase
    .from('projects')
    .select('uuid') // Only need UUID to check existence
    .eq('uuid', projectUuid)
    .maybeSingle();

  if (fetchError) {
    console.error(`Error checking existence of project ${projectUuid}:`, fetchError);
    throw new Error('Failed to check project existence before update');
  }

  if (!project) {
    throw new Error('Project not found');
  }

  // Now perform the update
  const { data: updatedProject, error: updateError } = await supabase
    .from('projects') // Use table name string
    .update({ name: newName })
    .eq('uuid', projectUuid)
    .select() // Select the updated row
    .single(); // Expect single result

  if (updateError || !updatedProject) {
    console.error(`Error updating project name ${projectUuid}:`, updateError);
    throw new Error('Failed to update project name');
  }

  return updatedProject; // Return single object
}

export async function deleteProject(projectUuid: string) {
  const supabase = await createClient();
  // No need to fetch the project first if we check the count

  // Check if this is the last project
  // Check project count first
  const { count: projectCount, error: countError } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true }); // Efficiently get count

  if (countError) {
    console.error("Error counting projects:", countError);
    throw new Error('Failed to count projects before deletion');
  }

  if (projectCount === 1) {
    throw new Error('Cannot delete the last project');
  }

  // Perform delete
  const { error: deleteError } = await supabase
    .from('projects') // Use table name string
    .delete()
    .eq('uuid', projectUuid);

  // Check if delete operation itself failed (e.g., RLS, network issue)
  // Note: Supabase delete might not error if the row doesn't exist, it just deletes 0 rows.
  if (deleteError) {
    console.error(`Error deleting project ${projectUuid}:`, deleteError);
    // Check if the error is due to the project not existing (if needed, e.g., PGRST116)
    // For now, assume any error is critical.
    throw new Error('Failed to delete project');
  }

  return { success: true };
}

export async function setActiveProject(projectUuid: string) {
  // This function seems identical to getProject, refactor similarly
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from('projects') // Use table name string
    .select('*')
    .eq('uuid', projectUuid)
    .maybeSingle(); // Returns object or null

  if (error) {
    console.error(`Error fetching project ${projectUuid} for setActiveProject:`, error);
    throw new Error('Failed to fetch project'); // Throw error on DB failure
  }

  if (!project) {
    throw new Error('Project not found'); // Throw error if null (not found)
  }

  return project; // Return the single object
}
