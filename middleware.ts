import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const { pathname, search } = request.nextUrl;

    // Allow API routes, internal Next.js routes, and static files to pass through
    // Allow only API routes to pass through
    if (pathname.startsWith('/api')) {
        return NextResponse.next();
    }

    // Redirect all other paths to mcpgarden.com, preserving path and query params
    const targetUrl = `https://mcpgarden.com${pathname}${search}`;

    // Use 308 for permanent redirect preserving the request method
    return NextResponse.redirect(new URL(targetUrl), 308);
}