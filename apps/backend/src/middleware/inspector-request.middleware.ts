import type express from "express";

/** Header sent by the MetaMCP web app on every inspector proxy request. */
export const INSPECTOR_REQUEST_HEADER = "x-metamcp-inspector";

/**
 * Guards the inspector proxy (/mcp-proxy) against cross-site requests.
 *
 * The proxy authenticates with the session cookie and opens MCP sessions
 * from plain GET requests (EventSource), including STDIO sessions that spawn
 * a command. Session cookies are SameSite=Lax, so they ride along on a
 * cross-site top-level navigation: without this guard, any page visited by a
 * signed-in administrator could run commands on the host.
 *
 * Requests must carry the X-MetaMCP-Inspector header, which the web app
 * sends and which another origin cannot add without a CORS preflight (only
 * APP_URL passes it), and must not be flagged cross-site by the browser.
 */
export function requireInspectorRequest(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const fetchSite = req.headers["sec-fetch-site"];
  const crossSite =
    typeof fetchSite === "string" &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none";
  if (crossSite || req.headers[INSPECTOR_REQUEST_HEADER] !== "1") {
    res.status(403).json({
      error: "forbidden",
      message:
        "The inspector proxy only accepts requests from the MetaMCP web app.",
    });
    return;
  }
  next();
}
