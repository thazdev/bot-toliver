import { logger } from '../../utils/logger.js';
import { RedisClient } from './RedisClient.js';

/**
 * Generic TTL-based caching service using Redis.
 * Provides typed get/set/delete operations with key namespacing.
 */
export class CacheService {
  private redis: RedisClient;

  constructor() {
    this.redis = RedisClient.getInstance();
  }

  /**
   * Retrieves a cached value by key.
   * @param key - Cache key
   * @returns The cached value or null if not found/expired
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.getClient().get(key);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('CacheService get error', { key, error: errorMsg });
      return null;
    }
  }

  /**
   * Sets a value in the cache with a TTL.
   * @param key - Cache key
   * @param value - Value to store (will be JSON serialized)
   * @param ttlSeconds - Time-to-live in seconds
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.redis.getClient().setex(key, ttlSeconds, serialized);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('CacheService set error', { key, error: errorMsg });
    }
  }

  /**
   * Deletes a cached value by key.
   * @param key - Cache key to delete
   */
  async del(key: string): Promise<void> {
    try {
      await this.redis.getClient().del(key);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('CacheService del error', { key, error: errorMsg });
    }
  }

  /**
   * Checks if a key exists in the cache.
   * @param key - Cache key
   * @returns True if the key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.getClient().exists(key);
      return result === 1;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('CacheService exists error', { key, error: errorMsg });
      return false;
    }
  }

  /**
   * Builds a namespaced cache key.
   * @param namespace - The namespace prefix (e.g. "token", "pool", "price")
   * @param id - The unique identifier
   * @returns The namespaced key
   */
  static buildKey(namespace: string, id: string): string {
    return `${namespace}:${id}`;
  }
}
