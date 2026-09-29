import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";

import type express from "express";

/**
 * Per-request metadata (client address, user agent) available anywhere down
 * the call chain, e.g. to the activity log, without threading it through
 * every function signature.
 */
export type RequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Express "trust proxy" setting from TRUST_PROXY: which peers may report the
 * client address through X-Forwarded-For (and protocol / host through
 * X-Forwarded-Proto / -Host). Default "loopback,uniquelocal": the bundled
 * Next.js server (same host) and reverse proxies on private networks (docker
 * networks, Kubernetes ingress, a LAN nginx). Clients that reach MetaMCP
 * directly from a private network could then choose their reported address:
 * set TRUST_PROXY=loopback (or the proxy's own address) in that case.
 * Accepts "true", "false", a hop count, or a comma separated list of
 * addresses, CIDR ranges and the names loopback, linklocal, uniquelocal.
 */
export function trustProxySetting(
  value: string | undefined,
): boolean | number | string[] {
  const raw = value?.trim().toLowerCase();
  if (!raw) return ["loopback", "uniquelocal"];
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Client address, as resolved by Express from the socket and the
 * X-Forwarded-For entries appended by trusted proxies (TRUST_PROXY).
 * IPv4-mapped IPv6 addresses are reported as plain IPv4.
 */
export function clientAddress(req: express.Request): string | null {
  // A trusted proxy passes on whatever the client put in X-Forwarded-For:
  // skip values that are not addresses, keeping the closest valid hop.
  const address =
    [req.ip, ...(req.ips ?? [])].find(
      (candidate): candidate is string =>
        typeof candidate === "string" && isIP(candidate) !== 0,
    ) ?? req.socket?.remoteAddress;
  return address ? address.replace(/^::ffff:/, "") : null;
}

/**
 * Bucket key of a client for per-client rate limits. The default strategy
 * key, X-Forwarded-For, is resolved through the trusted proxy chain
 * (TRUST_PROXY) rather than read raw: every client could otherwise get a
 * fresh bucket per request by sending a different value. Any other header is
 * the administrator's explicit choice of client identifier.
 */
export function clientRateLimitKey(
  req: express.Request,
  strategyKey: string,
): string {
  const header = strategyKey.trim().toLowerCase() || "x-forwarded-for";
  const address = clientAddress(req) ?? "unknown";
  if (header === "x-forwarded-for") {
    return `ip:${address}`;
  }
  const value = req.headers[header];
  const first = Array.isArray(value) ? value[0] : value;
  return first ? `header:${first}` : `ip:${address}`;
}

export function requestContextMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
): void {
  const userAgent = req.headers["user-agent"];
  storage.run(
    {
      ipAddress: clientAddress(req),
      userAgent: typeof userAgent === "string" ? userAgent.slice(0, 500) : null,
    },
    next,
  );
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
