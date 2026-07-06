/**
 * Simple in-memory rate limiter.
 * Tracks requests per IP with a sliding window.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) {
    if (now > w.resetAt) windows.delete(key);
  }
}, 5 * 60 * 1000).unref();

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/**
 * Returns true if the request is allowed, false if rate limited.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let w = windows.get(key);

  if (!w || now > w.resetAt) {
    w = { count: 0, resetAt: now + config.windowMs };
    windows.set(key, w);
  }

  w.count++;
  const remaining = Math.max(0, config.maxRequests - w.count);
  return { allowed: w.count <= config.maxRequests, remaining, resetAt: w.resetAt };
}

/** Per-IP: 5 submissions per minute */
export const SUBMIT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 5,
};

/** Per-IP: 30 submissions per hour */
export const SUBMIT_RATE_LIMIT_HOURLY: RateLimitConfig = {
  windowMs: 60 * 60 * 1000,
  maxRequests: 30,
};
