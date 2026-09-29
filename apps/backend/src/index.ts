import express from "express";

import { auth } from "./auth";
import { runWithAuthRequestContext } from "./lib/access/auth-request-context";
import { activityLog } from "./lib/activity/activity-log.service";
import {
  clientAddress,
  requestContextMiddleware,
  trustProxySetting,
} from "./lib/request-context";
import { secretsService } from "./lib/secrets/secrets.service";
import { initializeIdleServers, initializeOnStartup } from "./lib/startup";
import { assertSecureConfiguration } from "./lib/startup-checks";
import mcpProxyRouter from "./routers/mcp-proxy";
import oauthRouter from "./routers/oauth";
import publicEndpointsRouter from "./routers/public-metamcp";
import trpcRouter from "./routers/trpc";
import logger from "./utils/logger";

const app = express();

// Which proxies may report the client address (X-Forwarded-For) and the
// public protocol / host: rate limiting and the activity log rely on it.
app.set("trust proxy", trustProxySetting(process.env.TRUST_PROXY));
app.disable("x-powered-by");

// Client address / user agent for the activity log
app.use(requestContextMiddleware);

// Global JSON middleware for non-proxy routes. Bodies are parsed before any
// authentication, so the limit stays small: 5 MB for the web app's API
// (tool definitions, bulk imports), 1 MB elsewhere (auth, OAuth).
const trpcJson = express.json({ limit: "5mb" });
const defaultJson = express.json({ limit: "1mb" });
app.use((req, res, next) => {
  if (req.path.startsWith("/mcp-proxy/") || req.path.startsWith("/metamcp/")) {
    // Skip JSON parsing for all MCP proxy routes and public endpoints to allow raw stream access
    next();
  } else if (req.path.startsWith("/trpc/")) {
    trpcJson(req, res, next);
  } else {
    defaultJson(req, res, next);
  }
});

// Mount OAuth metadata endpoints at root level for .well-known discovery
app.use(oauthRouter);

// Mount better-auth routes by calling auth API directly
app.use(async (req, res, next) => {
  if (req.path.startsWith("/api/auth")) {
    try {
      // Create a web Request object from Express request
      const url = new URL(req.url, `http://${req.headers.host}`);
      const headers = new Headers();

      // Copy headers from Express request
      Object.entries(req.headers).forEach(([key, value]) => {
        if (value) {
          headers.set(key, Array.isArray(value) ? value[0] : value);
        }
      });
      // better-auth keys its sign-in rate limits on X-Forwarded-For. The
      // incoming header may be client-supplied (Next.js passes it through
      // untouched), so hand over the address resolved from trusted proxies.
      const address = clientAddress(req);
      if (address) {
        headers.set("x-forwarded-for", address);
      } else {
        headers.delete("x-forwarded-for");
      }

      // Create Request object
      const request = new Request(url.toString(), {
        method: req.method,
        headers,
        body:
          req.method !== "GET" && req.method !== "HEAD"
            ? JSON.stringify(req.body)
            : undefined,
      });

      // Call better-auth directly. The request context lets OIDC profile
      // mapping hand the groups claim over to the RBAC database hooks.
      const response = await runWithAuthRequestContext({}, () =>
        auth.handler(request),
      );

      // Convert Response back to Express response
      res.status(response.status);

      // Copy headers. Set-Cookie can repeat (session token, cached session
      // data...): setting it once per value would keep only the last cookie.
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") {
          res.setHeader(key, value);
        }
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) {
        res.setHeader("set-cookie", cookies);
      }

      // Send body
      const body = await response.text();
      res.send(body);
    } catch (error) {
      logger.error("Auth route error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
    return;
  }
  next();
});

// Mount public endpoints routes (must be before JSON middleware to handle raw streams)
app.use("/metamcp", publicEndpointsRouter);

// Mount MCP proxy routes
app.use("/mcp-proxy", mcpProxyRouter);

// Mount tRPC routes
app.use("/trpc", trpcRouter);

async function start(): Promise<void> {
  // Placeholder secrets from the example configuration: refuse production
  assertSecureConfiguration();

  // Encryption keys must be loaded before anything reads or writes secrets.
  // Without them stored credentials are unusable, so refuse to start.
  try {
    await secretsService.initialize();
  } catch (error) {
    console.error(
      "❌ Cannot load the keys protecting stored secrets:",
      error instanceof Error ? error.message : error,
    );
    // eslint-disable-next-line no-process-exit -- intentional: serving without decryption keys would break every stored credential
    process.exit(1);
  }

  // Startup initialization (must run after DB is reachable/migrations are applied, and before listening)
  await initializeOnStartup();

  // Activity log retention (ACTIVITY_LOG_RETENTION_DAYS, default 365 days)
  activityLog.startRetention();

  app.listen(12009, async (error?: Error) => {
    // Express 5 reports listen failures (port in use...) here
    if (error) {
      console.error("❌ Cannot listen on port 12009:", error.message);
      // eslint-disable-next-line no-process-exit -- intentional: a backend that does not listen must not keep running
      process.exit(1);
    }
    console.log(`Server is running on port 12009`);
    console.log(`Auth routes available at: http://localhost:12009/api/auth`);
    console.log(
      `Public MetaMCP endpoints available at: http://localhost:12009/metamcp`,
    );
    console.log(
      `MCP Proxy routes available at: http://localhost:12009/mcp-proxy`,
    );
    console.log(`tRPC routes available at: http://localhost:12009/trpc`);

    // Wait a moment for the server to be fully ready to handle incoming connections,
    // then initialize idle servers (prevents connection errors when MCP servers connect back)
    console.log(
      "Waiting for server to be fully ready before initializing idle servers...",
    );
    await new Promise((resolve) => setTimeout(resolve, 3000)).then(
      initializeIdleServers,
    );
  });
}

start().catch((err) => {
  // Recoverable problems are handled (and logged) inside start(); what gets
  // here (e.g. BOOTSTRAP_FAIL_HARD) must stop the process instead of leaving
  // it running without listening.
  console.error("❌ Fatal startup error:", err);
  // eslint-disable-next-line no-process-exit -- intentional: fail fast so the orchestrator restarts or reports the service
  process.exit(1);
});

// Graceful shutdown: clean up MCP server pools on SIGTERM/SIGINT
// Prevents orphaned STDIO child processes when backend restarts
const gracefulShutdown = async (signal: string) => {
  console.log(`${signal} received, cleaning up MCP server pools...`);
  try {
    const { mcpServerPool } = await import("./lib/metamcp");
    const { metaMcpServerPool } =
      await import("./lib/metamcp/metamcp-server-pool");
    await Promise.allSettled([
      mcpServerPool.cleanupAll(),
      metaMcpServerPool.cleanupAll(),
    ]);
    console.log("MCP server pools cleaned up successfully");
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
  }
  // eslint-disable-next-line no-process-exit -- intentional: terminate the process after async cleanup in the shutdown signal handler
  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
  });
});
