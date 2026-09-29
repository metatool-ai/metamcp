import rateLimit from "express-rate-limit";

import { nonNegativeIntFromEnv } from "../lib/session-lifetime-manager";

/**
 * Requests per minute accepted from one client address on every route, far
 * above what people and MCP clients send (HTTP_RATE_LIMIT_PER_MINUTE,
 * 0 = no limit). The client address honours TRUST_PROXY.
 */
const HTTP_RATE_LIMIT_PER_MINUTE = nonNegativeIntFromEnv(
  process.env.HTTP_RATE_LIMIT_PER_MINUTE,
  3000,
);

export const httpRateLimit = rateLimit({
  windowMs: 60_000,
  limit: HTTP_RATE_LIMIT_PER_MINUTE,
  skip: () => HTTP_RATE_LIMIT_PER_MINUTE === 0,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, try again in a minute" },
});
