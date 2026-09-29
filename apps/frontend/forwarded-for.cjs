/**
 * Preloaded into the Next.js server (NODE_OPTIONS=--require, see
 * docker-entrypoint.sh). Appends the TCP peer address to X-Forwarded-For on
 * every incoming request, as a reverse proxy does
 * ($proxy_add_x_forwarded_for). Next.js forwards the header, untouched, when
 * it proxies /api/auth, /trpc, /metamcp, /oauth... to the backend, which
 * then resolves the client address through the proxies it trusts
 * (TRUST_PROXY). Without it the backend saw 127.0.0.1 for every client, or
 * whatever X-Forwarded-For the client chose to send.
 */
"use strict";

const http = require("node:http");

const emit = http.Server.prototype.emit;

http.Server.prototype.emit = function emitWithForwardedFor(event, req, ...rest) {
  if ((event === "request" || event === "upgrade") && req && req.headers) {
    const peer = req.socket && req.socket.remoteAddress;
    if (peer) {
      const existing = req.headers["x-forwarded-for"];
      req.headers["x-forwarded-for"] = existing
        ? `${Array.isArray(existing) ? existing.join(", ") : existing}, ${peer}`
        : peer;
    }
  }
  return emit.call(this, event, req, ...rest);
};
