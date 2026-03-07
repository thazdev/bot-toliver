import { Redis } from 'ioredis';
import { logger } from '../../utils/logger.js';
import type { RedisConfig } from '../../types/config.types.js';

/**
 * Singleton Redis client for caching and queue backends.
 */
export class RedisClient {
  private static instance: RedisClient | null = null;
  private client: Redis;

  private constructor(config: RedisConfig) {
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password || undefined,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => {
        if (times > 10) {
          logger.error('Redis max reconnection attempts reached');
          return null;
        }
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
    });

    this.client.on('connect', () => {
      logger.info('Redis connected', { host: config.host, port: config.port });
    });

    this.client.on('error', (error: Error) => {
      logger.error('Redis connection error', { error: error.message });
    });

    this.client.on('close', () => {
      logger.warn('Redis connection closed');
    });
  }

  /**
   * Initializes the Redis client singleton.
   * @param config - Redis connection configuration
   * @returns The singleton RedisClient instance
   */
  static initialize(config: RedisConfig): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient(config);
    }
    return RedisClient.instance;
  }

  /**
   * Returns the singleton instance.
   * @returns The RedisClient instance
   */
  static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      throw new Error('RedisClient not initialized. Call initialize() first.');
    }
    return RedisClient.instance;
  }

  /**
   * Returns the raw ioredis client for direct commands.
   * @returns The ioredis Redis instance
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Gracefully disconnects from Redis.
   */
  async disconnect(): Promise<void> {
    await this.client.quit();
    RedisClient.instance = null;
    logger.info('Redis disconnected');
  }
}
