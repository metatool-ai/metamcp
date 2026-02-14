// rateLimiting.ts
// Rate limiting for protecting MCP servers from abuse

import logger from "../utils/logger";
import { mcpServerPool } from "./metamcp/mcp-server-pool";

type Context = Record<string, any>;
type CallNext = (context: Context) => Promise<any>;

export class RateLimitError extends Error {
  public code: number;

  constructor(message: string = "Rate limit exceeded") {
    super(message);
    this.code = -32000;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Token bucket implementation for rate limiting.
 */
export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRate: number;
  private tokens: number;
  private lastRefill: number;

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now() / 1000; // seconds
  }

  async consume(tokens: number = 1): Promise<boolean> {
    const now = Date.now() / 1000;
    const elapsed = now - this.lastRefill;

    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillRate,
    );
    this.lastRefill = now;
    logger.debug("tokens", this.tokens);

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }
}

/**
 * Sliding window rate limiter.
 */
export class SlidingWindowRateLimiter {
  private clientMaxRate: number;
  private clientMaxRateSeconds: number;
  private requests: number[] = [];

  constructor(clientMaxRate: number, clientMaxRateSeconds: number) {
    this.clientMaxRate = clientMaxRate;
    this.clientMaxRateSeconds = clientMaxRateSeconds;
  }

  async isAllowed(): Promise<boolean> {
    const now = Date.now() / 1000;
    const cutoff = now - this.clientMaxRateSeconds;
    // Remove old requests
    this.requests = this.requests.filter((t) => t >= cutoff);
    if (this.requests.length < this.clientMaxRate) {
      this.requests.push(now);
      return true;
    }
    return false;
  }
}

/**
 * Rate limiting (token bucket).
 */
export class RateLimiting {
  private maxRateSeconds: number;
  private maxRate: number;
  private limiters: Map<string, TokenBucketRateLimiter>;

  constructor() {
    this.maxRateSeconds = 0;
    this.maxRate = 0;
    this.limiters = new Map();
  }

  async onRequest(context: Context, callNext: CallNext): Promise<any> {
    const { endpoint } = context.req;
    const { user_id, namespace_uuid } = endpoint;
    const backgroundIdleSessions =
      mcpServerPool.getBackgroundIdleSessionsByNamespace();
    let limiter = this.limiters.get(namespace_uuid);

    this.maxRateSeconds = endpoint.max_rate_seconds ?? 0;
    this.maxRate = endpoint.max_rate ?? 0;

    if (backgroundIdleSessions.size > 0) {
      if (
        backgroundIdleSessions.get(namespace_uuid)?.get("status") === "created"
      ) {
        if (!backgroundIdleSessions.get(namespace_uuid)?.has(user_id)) {
          backgroundIdleSessions
            .get(namespace_uuid)
            ?.set(user_id, "initialized");
          if (!limiter) {
            this.limiters.set(
              namespace_uuid,
              new TokenBucketRateLimiter(this.maxRate, this.maxRateSeconds),
            );
            limiter = this.limiters.get(namespace_uuid);
          }
        }
      }

      const allowed = await limiter?.consume();
      if (!allowed) {
        throw new RateLimitError(`Rate limit exceeded`);
      }
    }
    return callNext(context);
  }
}

/**
 * Sliding window rate limiting.
 */
export class SlidingWindowRateLimiting {
  private limiters: Map<string, Map<string, SlidingWindowRateLimiter>>;
  private clientMaxRate: number;
  private clientMaxRateSeconds: number;
  private clientMaxRateStrategy: string;
  private clientMaxRateStrategyKey: string;
  constructor() {
    this.clientMaxRate = 0;
    this.clientMaxRateSeconds = 0;
    this.clientMaxRateStrategy = "ip";
    this.clientMaxRateStrategyKey = "x-forwarded-for";
    this.limiters = new Map();
  }

  async onRequest(context: Context, callNext: CallNext): Promise<any> {
    const { endpoint, socket, headers } = context.req;
    const { namespace_uuid } = endpoint;
    this.clientMaxRate = endpoint.client_max_rate;
    this.clientMaxRateSeconds = endpoint.client_max_rate_seconds;
    this.clientMaxRateStrategy =
      endpoint.client_max_rate_strategy === ""
        ? this.clientMaxRateStrategy
        : endpoint.client_max_rate_strategy;
    this.clientMaxRateStrategyKey =
      endpoint.client_max_rate_strategy_key === ""
        ? this.clientMaxRateStrategyKey
        : endpoint.client_max_rate_strategy_key;

    const backgroundIdleSessions =
      mcpServerPool.getBackgroundIdleSessionsByNamespace();
    const key = headers[this.clientMaxRateStrategyKey] || socket.remoteAddress;

    let limiter = this.limiters.get(key);

    if (backgroundIdleSessions.size > 0) {
      if (
        backgroundIdleSessions.get(namespace_uuid)?.get("status") === "created"
      ) {
        if (!backgroundIdleSessions.get(namespace_uuid)?.has(key)) {
          backgroundIdleSessions.get(namespace_uuid)?.set(key, "initialized");
          if (!limiter) {
            this.limiters.set(
              key,
              new Map().set(
                namespace_uuid,
                new SlidingWindowRateLimiter(
                  this.clientMaxRate,
                  this.clientMaxRateSeconds,
                ),
              ),
            );
            limiter = this.limiters.get(key);
          } else {
            if (!limiter.has(key)) {
              limiter.set(
                namespace_uuid,
                new SlidingWindowRateLimiter(
                  this.clientMaxRate,
                  this.clientMaxRateSeconds,
                ),
              );
            }
          }
        }
      }

      const slidingWindowLimiter = limiter?.get(namespace_uuid);
      if (slidingWindowLimiter) {
        const allowed = await slidingWindowLimiter?.isAllowed();
        if (!allowed) {
          throw new RateLimitError(
            `Rate limit exceeded: ${this.clientMaxRate} requests per ${this.clientMaxRateSeconds} second/s`,
          );
        }
      }
    }

    return callNext(context);
  }

  async onResponse(context: Context, callNext: CallNext): Promise<any> {
    return callNext(context);
  }
}
