import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/utils/supabase/middleware'; // Import the Supabase middleware

export async function middleware(request: NextRequest) {
    // Run Supabase session management first
    const supabaseResponse = await updateSession(request);
    const { pathname, search } = request.nextUrl;

    // Allow API routes, internal Next.js routes, and static files to pass through
    // Allow only API routes to pass through
    // If the request is for an API route, return the response from updateSession
    // which contains the necessary cookie updates.
    if (pathname.startsWith('/api')) {
        return supabaseResponse;
    }

    // Redirect all other paths to mcpgarden.com, preserving path and query params
    const targetUrl = `https://mcpgarden.com${pathname}${search}`;

    // Use 308 for permanent redirect preserving the request method
    // For non-API routes, perform the redirect.
    // Note: The redirect response won't have the updated Supabase cookies,
    // but this might be okay if mcpgarden.com handles its own auth.
    // If auth state needed to persist across the redirect, more complex handling is needed.
    return NextResponse.redirect(new URL(targetUrl), 308);
}