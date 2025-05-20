import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// This middleware enforces authentication for all routes except /login, api, and static assets.
// It assumes that a valid Supabase session token is stored in a cookie named "sb:token".
// Adjust the cookie name as needed based on your Supabase authentication configuration.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow requests for static files, API routes, and the login page.
  if (
    /^\/api\/.*/.test(pathname) ||
    pathname.startsWith('/_next') ||
    pathname === '/login' ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Get the Supabase auth token from cookies
  const token = request.cookies.get('sb:token')?.value;

  // If there is no token, redirect to the login page.
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
      Match all request paths except for:
      - /api/ (API routes)
      - /_next/ (Next.js internals)
      - /login (Login page)
      - /favicon.ico (Favicon)
    */
    '/((?!api\\/|_next/static|_next/image|login|favicon.ico).*)'
  ],
};
