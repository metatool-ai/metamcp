import { DatabaseEndpoint } from "@repo/zod-types";
import { NextFunction, Request, Response } from "express";
import express from "express";

import {
  RateLimitError,
  RateLimiting,
  SlidingWindowRateLimiting,
} from "@/lib/rate-limit";

const slidingWindowRateLimit = new SlidingWindowRateLimiting();
const tokenBucketRateLimit = new RateLimiting();

// Periodic cleanup of stale rate limiter entries (every 30 minutes)
setInterval(() => {
  tokenBucketRateLimit.cleanup();
  slidingWindowRateLimit.cleanup();
}, 30 * 60 * 1000);

interface RateLimitOptions extends express.Request {
  endpoint: DatabaseEndpoint;
}

/**
 * Express adapter for TokenBucket rate limiting middleware
 */
const tokenBucketHandler = async function (
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    await tokenBucketRateLimit.onRequest({ req }, async () => {
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

/**
 * Express adapter for Sliding Window rate limiting middleware
 */
const slidingWindowHandler = async function (
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    await slidingWindowRateLimit.onRequest({ req }, async () => {
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

/**
 * Combined rate limiter that runs both sliding window and token bucket limiters sequentially
 */
const combinedHandler = async function (
  req: Request,
  res: Response,
  next: NextFunction,
) {
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
          res.status(429).json({ error: err.message });
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

export const rateLimitMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const { endpoint } = req as RateLimitOptions;
  if (endpoint.enable_client_max_rate && endpoint.enable_max_rate) {
    combinedHandler(req, res, next);
  } else if (endpoint.enable_client_max_rate) {
    slidingWindowHandler(req, res, next);
  } else if (endpoint.enable_max_rate) {
    tokenBucketHandler(req, res, next);
  } else {
    next();
  }
};
