import { Request, Response, NextFunction } from "express";
import { RateLimiting, RateLimitError, SlidingWindowRateLimiting } from "@/lib/rate-limit";
import { DatabaseEndpoint } from "@repo/zod-types";
import express from "express";
import logger from "@/utils/logger";

const slidingWindowRateLimit = new SlidingWindowRateLimiting();
const tokenBucketRateLimit = new RateLimiting();

interface RateLimitOptions extends express.Request {
  endpoint: DatabaseEndpoint;
}


/**
 * Express adapter for TokenBucket rate limiting middleware
 */
const tokenBucketRateLimiter = () => {
  const limiter = tokenBucketRateLimit;

  return async function (req: Request, res: Response, next: NextFunction) {
    try {
      await limiter.onRequest({ req }, async () => {
        return next();
      });
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.status(503).json({ error: err.message });
      } else {
        next(err);
      }
    }
  };
}

/**
 * Express adapter for Sliding Window rate limiting middleware
 */
const slidingWindowRateLimiter = () => {
  const limiter = slidingWindowRateLimit;

  return async function (req: Request, res: Response, next: NextFunction) {
    try {
      await limiter.onRequest({ req }, async () => {
        return next();
      });
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.status(429).json({ error: err.message });
      } else {
        next(err);
      }
    }
  };
}

/**
 * Combined rate limiter that runs both sliding window and token bucket limiters sequentially
 */
const rateLimiter = () => {
  return async function (req: Request, res: Response, next: NextFunction) {
    // First, run sliding window rate limiter
    try {
      await slidingWindowRateLimit.onRequest({ req }, async () => {
        // If sliding window passes, run token bucket rate limiter
        try {
          await tokenBucketRateLimit.onRequest({ req }, async () => {
            // Both limiters passed, proceed to next middleware
            return next();
          });
        } catch (err) {
          if (err instanceof RateLimitError) {
            res.status(503).json({ error: err.message });
          } else {
            next(err);
          }
        }
      });
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.status(429).json({ error: err.message });
      } else {
        next(err);
      }
    }
  };
}

export const rateLimitMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { endpoint } = req as RateLimitOptions;
  if (endpoint.enable_client_max_rate && endpoint.enable_max_rate) {
    rateLimiter()(req, res, next);
  } else if (endpoint.enable_client_max_rate) {
    slidingWindowRateLimiter()(req, res, next);
  } else if (endpoint.enable_max_rate) {
    tokenBucketRateLimiter()(req, res, next);
  } else {
    next();
  }
}
