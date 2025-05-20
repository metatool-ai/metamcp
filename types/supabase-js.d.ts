declare module '@supabase/supabase-js' {
  export function createClient(supabaseUrl: string, supabaseKey: string): any;

  export interface Session {
    user?: any;
    access_token?: string;
    // Add more fields as needed for your use case
  }

  export type AuthChangeEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY';
}
