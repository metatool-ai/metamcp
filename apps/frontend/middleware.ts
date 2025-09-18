import { betterFetch } from "@better-fetch/fetch";
import { NextRequest, NextResponse } from "next/server";

const locales = ["en", "zh"];
const defaultLocale = "en";

// Get the preferred locale from the request
function getLocale(request: NextRequest): string {
  // Check if there's a locale in the pathname
  const pathname = request.nextUrl.pathname;
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );

  if (pathnameHasLocale) {
    return pathname.split("/")[1] || defaultLocale;
  }

  // Check cookies for saved preference first (user's explicit choice)
  const savedLocale = request.cookies.get("preferred-language")?.value;
  if (savedLocale && locales.includes(savedLocale)) {
    return savedLocale;
  }

  // Check Accept-Language header as fallback
  const acceptLanguage = request.headers.get("accept-language");
  if (acceptLanguage) {
    // Simple language detection - look for zh in accept-language
    if (acceptLanguage.includes("zh")) {
      return "zh";
    }
  }

  return defaultLocale;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip middleware for static files and API routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/trpc") ||
    pathname.startsWith("/mcp-proxy") ||
    pathname.startsWith("/metamcp") ||
    pathname.startsWith("/oauth") ||
    pathname.startsWith("/.well-known") ||
    pathname.startsWith("/service") ||
    pathname.startsWith("/health") ||
    pathname.startsWith("/fe-oauth") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Handle i18n routing first
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );

  let locale = defaultLocale;
  let pathnameWithoutLocale = pathname;

  if (pathnameHasLocale) {
    locale = pathname.split("/")[1] || defaultLocale;
    pathnameWithoutLocale = pathname.slice(locale.length + 1) || "/";
  } else {
    // Redirect to the appropriate locale
    locale = getLocale(request);
    const newUrl = new URL(`/${locale}${pathname}`, request.url);
    // Preserve query parameters during redirect
    newUrl.search = request.nextUrl.search;
    return NextResponse.redirect(newUrl);
  }

  // Now handle authentication for the pathname without locale
  const publicRoutes = ["/login", "/register", "/", "/cors-error"];
  if (publicRoutes.includes(pathnameWithoutLocale)) {
    return NextResponse.next();
  }

  try {
    // Get the original host for nginx compatibility
    const originalHost =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      "";

    // Check if user is authenticated by calling the session endpoint
    const { data: session } = await betterFetch("/api/auth/get-session", {
      // this hardcoded is correct, because in same container, we should use localhost, outside url won't work
      baseURL: "http://localhost:12009",
      headers: {
        cookie: request.headers.get("cookie") || "",
        // Pass nginx-forwarded host headers for better-auth baseURL resolution
        host: originalHost,
        // Include nginx forwarding headers if present
        "x-forwarded-host": request.headers.get("x-forwarded-host") || "",
        "x-forwarded-proto": request.headers.get("x-forwarded-proto") || "",
        "x-forwarded-for": request.headers.get("x-forwarded-for") || "",
      },
    });

    if (!session) {
      // Redirect to login if not authenticated (with locale)
      const loginUrl = new URL(`/${locale}/login`, request.url);
      loginUrl.searchParams.set("callbackUrl", pathnameWithoutLocale);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    // On error, redirect to login (with locale)
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("callbackUrl", pathnameWithoutLocale);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    // Skip all internal paths (_next, etc.)
    "/((?!_next|api/|trpc|mcp-proxy|metamcp|oauth|fe-oauth|\\.well-known|service|health|.*\\..*).*)",
  ],
};
