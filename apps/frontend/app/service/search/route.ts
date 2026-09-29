import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side relay to the public MCP server registry used by the Explore
 * page. It replaces a rewrite that proxied the browser's request as is, so
 * every visit sent the user's MetaMCP session cookie to the third-party host
 * and served whatever it answered from the MetaMCP origin. Only the search
 * parameters go out; only JSON comes back.
 */
const REGISTRY_SEARCH_URL =
  "https://metatool-service.jczstudio.workers.dev/search";
const FORWARDED_PARAMS = ["query", "pageSize", "offset"] as const;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const target = new URL(REGISTRY_SEARCH_URL);
  for (const name of FORWARDED_PARAMS) {
    const value = request.nextUrl.searchParams.get(name);
    if (value !== null) {
      target.searchParams.set(name, value.slice(0, 200));
    }
  }

  try {
    const response = await fetch(target, {
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `Registry search failed (${response.status})` },
        { status: 502 },
      );
    }
    const data: unknown = await response.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Registry search is unavailable" },
      { status: 502 },
    );
  }
}
