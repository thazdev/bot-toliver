import Bottleneck from 'bottleneck';
import { logger } from '../../utils/logger.js';
import { QUEUE_RATE_LIMIT_WARNING_THRESHOLD } from '../../utils/constants.js';
import type { RateLimitConfig } from '../../types/config.types.js';

/**
 * Singleton RPC rate limiter wrapping Bottleneck.
 * Enforces per-second and concurrency limits on all outgoing RPC calls.
 */
export class RateLimiter {
  private static instance: RateLimiter | null = null;
  private limiter: Bottleneck;
  private requestCount = 0;
  private requestCountResetAt = Date.now();

  private constructor(config: RateLimitConfig) {
    this.limiter = new Bottleneck({
      maxConcurrent: config.rpcMaxConcurrent,
      minTime: Math.floor(1000 / config.rpcRequestsPerSecond),
      reservoir: config.rpcRequestsPerSecond,
      reservoirRefreshInterval: 1000,
      reservoirRefreshAmount: config.rpcRequestsPerSecond,
    });

    let lastWarnAt = 0;
    this.limiter.on('depleted', () => {
      const queued = this.limiter.queued();
      if (queued > QUEUE_RATE_LIMIT_WARNING_THRESHOLD) {
        const now = Date.now();
        if (now - lastWarnAt > 30_000) {
          lastWarnAt = now;
          logger.warn('Rate limiter queue growing large', { queuedRequests: queued });
        }
      }
    });
  }

  /**
   * Initializes the singleton with the given config.
   * @param config - Rate limit configuration
   * @returns The singleton RateLimiter instance
   */
  static initialize(config: RateLimitConfig): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter(config);
      logger.debug('RateLimiter initialized', {
        maxConcurrent: config.rpcMaxConcurrent,
        requestsPerSecond: config.rpcRequestsPerSecond,
      });
    }
    return RateLimiter.instance;
  }

  /**
   * Returns the existing singleton instance.
   * @returns The RateLimiter instance
   */
  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      throw new Error('RateLimiter not initialized. Call initialize() first.');
    }
    return RateLimiter.instance;
  }

  /**
   * Schedules an async function to run within the rate limit.
   * @param fn - Async function to execute
   * @returns The result of the function
   */
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    this.requestCount++;
    return this.limiter.schedule(fn);
  }

  /**
   * Returns and resets the request counter.
   * Useful for monitoring RPC usage over time.
   */
  getAndResetRequestCount(): { count: number; periodMs: number } {
    const now = Date.now();
    const result = { count: this.requestCount, periodMs: now - this.requestCountResetAt };
    this.requestCount = 0;
    this.requestCountResetAt = now;
    return result;
  }

  /**
   * Returns the number of queued requests.
   * @returns Queue length
   */
  getQueueLength(): number {
    return this.limiter.queued();
  }
}
