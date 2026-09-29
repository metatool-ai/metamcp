import { betterFetch } from "@better-fetch/fetch";
import { NextRequest, NextResponse } from "next/server";

const locales = ["en", "fr", "zh", "ko", "pt", "es"];
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

  // Accept-Language fallback: the supported language with the highest
  // preference (q) wins, e.g. "fr-FR,fr;q=0.9,en;q=0.8" -> "fr".
  const acceptLanguage = request.headers.get("accept-language");
  if (acceptLanguage) {
    const preferred = acceptLanguage
      .split(",")
      .map((part, index) => {
        const [tag = "", ...params] = part.trim().split(";");
        const q = params
          .map((param) => param.trim())
          .find((param) => param.startsWith("q="));
        const weight = q ? Number(q.slice(2)) : 1;
        return {
          language: tag.toLowerCase().split("-")[0] ?? "",
          weight: Number.isFinite(weight) ? weight : 0,
          index,
        };
      })
      .filter((entry) => entry.weight > 0 && locales.includes(entry.language))
      .sort((a, b) => b.weight - a.weight || a.index - b.index)[0];
    if (preferred) {
      return preferred.language;
    }
  }

  return defaultLocale;
}

const ADMIN_ROUTES = ["/admin", "/settings", "/live-logs"];

function isAdminRoute(pathname: string): boolean {
  return ADMIN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

// Effective role (base role + group roles) comes from the backend.
async function fetchIsAdmin(cookie: string): Promise<boolean> {
  try {
    // tRPC procedure "frontend.access.me", mounted under /trpc/frontend
    const response = await fetch(
      "http://localhost:12009/trpc/frontend/frontend.access.me",
      { headers: { cookie }, cache: "no-store" },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as {
      result?: { data?: { isAdmin?: boolean } | null };
    };
    return body.result?.data?.isAdmin === true;
  } catch {
    return false;
  }
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
      // Redirect to login if not authenticated (with locale). The query is
      // kept: the OAuth consent page (/authorize?request=...) needs it.
      const loginUrl = new URL(`/${locale}/login`, request.url);
      loginUrl.searchParams.set(
        "callbackUrl",
        `${pathnameWithoutLocale}${request.nextUrl.search}`,
      );
      return NextResponse.redirect(loginUrl);
    }

    // Administration pages, server settings and live logs are reserved to
    // administrators. The backend enforces it too; this avoids rendering
    // pages whose data calls would all be refused.
    if (isAdminRoute(pathnameWithoutLocale)) {
      const isAdmin = await fetchIsAdmin(request.headers.get("cookie") || "");
      if (!isAdmin) {
        const deniedUrl = new URL(`/${locale}/access-denied`, request.url);
        deniedUrl.searchParams.set("from", pathnameWithoutLocale);
        return NextResponse.redirect(deniedUrl);
      }
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
