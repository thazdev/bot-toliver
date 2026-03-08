import Redis from 'ioredis';
import { dashboardConfig } from '@/config/dashboard.config';

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis =
  globalForRedis.redis ??
  (dashboardConfig.redis.url
    ? new Redis(dashboardConfig.redis.url, { maxRetriesPerRequest: 3, lazyConnect: true })
    : new Redis({
        host: dashboardConfig.redis.host,
        port: dashboardConfig.redis.port,
        password: dashboardConfig.redis.password,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      }));

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

export function createRedisSubscriber() {
  return dashboardConfig.redis.url
    ? new Redis(dashboardConfig.redis.url!, { maxRetriesPerRequest: 3 })
    : new Redis({
        host: dashboardConfig.redis.host,
        port: dashboardConfig.redis.port,
        password: dashboardConfig.redis.password,
        maxRetriesPerRequest: 3,
      });
}
