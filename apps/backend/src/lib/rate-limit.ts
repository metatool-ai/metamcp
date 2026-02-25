// rateLimiting.ts
// Rate limiting for protecting MCP servers from abuse

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

  consume(tokens: number = 1): boolean {
    const now = Date.now() / 1000;
    const elapsed = now - this.lastRefill;

    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillRate,
    );
    this.lastRefill = now;

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  getLastRefill(): number {
    return this.lastRefill;
  }
}

/**
 * Sliding window rate limiter.
 */
export class SlidingWindowRateLimiter {
  private clientMaxRate: number;
  private clientMaxRateSeconds: number;
  private requests: number[] = [];
  private lastAccess: number;

  constructor(clientMaxRate: number, clientMaxRateSeconds: number) {
    this.clientMaxRate = clientMaxRate;
    this.clientMaxRateSeconds = clientMaxRateSeconds;
    this.lastAccess = Date.now() / 1000;
  }

  isAllowed(): boolean {
    const now = Date.now() / 1000;
    this.lastAccess = now;
    const cutoff = now - this.clientMaxRateSeconds;
    // Remove old requests
    this.requests = this.requests.filter((t) => t >= cutoff);
    if (this.requests.length < this.clientMaxRate) {
      this.requests.push(now);
      return true;
    }
    return false;
  }

  getLastAccess(): number {
    return this.lastAccess;
  }
}

/**
 * Rate limiting (token bucket).
 */
export class RateLimiting {
  private limiters: Map<string, TokenBucketRateLimiter>;

  constructor() {
    this.limiters = new Map();
  }

  async onRequest(context: Context, callNext: CallNext): Promise<any> {
    const { endpoint } = context.req;
    const { user_id, namespace_uuid } = endpoint;
    const backgroundIdleSessions =
      mcpServerPool.getBackgroundIdleSessionsByNamespace();
    let limiter = this.limiters.get(namespace_uuid);

    const maxRateSeconds = endpoint.max_rate_seconds ?? 0;
    const maxRate = endpoint.max_rate ?? 0;

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
              new TokenBucketRateLimiter(maxRate, maxRateSeconds),
            );
            limiter = this.limiters.get(namespace_uuid);
          }
        }
      }

      const allowed = limiter?.consume();
      if (!allowed) {
        throw new RateLimitError(`Rate limit exceeded`);
      }
    }
    return callNext(context);
  }

  cleanup(maxIdleSeconds: number = 1800): void {
    const now = Date.now() / 1000;
    for (const [key, limiter] of this.limiters.entries()) {
      if (now - limiter.getLastRefill() > maxIdleSeconds) {
        this.limiters.delete(key);
      }
    }
  }
}

/**
 * Sliding window rate limiting.
 */
export class SlidingWindowRateLimiting {
  private limiters: Map<string, Map<string, SlidingWindowRateLimiter>>;

  constructor() {
    this.limiters = new Map();
  }

  async onRequest(context: Context, callNext: CallNext): Promise<any> {
    const { endpoint, socket, headers } = context.req;
    const { namespace_uuid } = endpoint;
    const clientMaxRate = endpoint.client_max_rate;
    const clientMaxRateSeconds = endpoint.client_max_rate_seconds;
    const clientMaxRateStrategyKey =
      endpoint.client_max_rate_strategy_key === ""
        ? "x-forwarded-for"
        : endpoint.client_max_rate_strategy_key;

    const backgroundIdleSessions =
      mcpServerPool.getBackgroundIdleSessionsByNamespace();
    const key = headers[clientMaxRateStrategyKey] || socket.remoteAddress;

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
                  clientMaxRate,
                  clientMaxRateSeconds,
                ),
              ),
            );
            limiter = this.limiters.get(key);
          } else {
            if (!limiter.has(namespace_uuid)) {
              limiter.set(
                namespace_uuid,
                new SlidingWindowRateLimiter(
                  clientMaxRate,
                  clientMaxRateSeconds,
                ),
              );
            }
          }
        }
      }

      const slidingWindowLimiter = limiter?.get(namespace_uuid);
      if (slidingWindowLimiter) {
        const allowed = slidingWindowLimiter.isAllowed();
        if (!allowed) {
          throw new RateLimitError(
            `Rate limit exceeded: ${clientMaxRate} requests per ${clientMaxRateSeconds} second/s`,
          );
        }
      }
    }

    return callNext(context);
  }

  cleanup(maxIdleSeconds: number = 1800): void {
    const now = Date.now() / 1000;
    for (const [key, innerMap] of this.limiters.entries()) {
      for (const [ns, limiter] of innerMap.entries()) {
        if (now - limiter.getLastAccess() > maxIdleSeconds) {
          innerMap.delete(ns);
        }
      }
      if (innerMap.size === 0) {
        this.limiters.delete(key);
      }
    }
  }
}
