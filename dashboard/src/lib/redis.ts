import Redis from 'ioredis';
import { dashboardConfig } from '@/config/dashboard.config';

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis =
  globalForRedis.redis ??
  new Redis({
    host: dashboardConfig.redis.host,
    port: dashboardConfig.redis.port,
    password: dashboardConfig.redis.password,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

export function createRedisSubscriber() {
  return new Redis({
    host: dashboardConfig.redis.host,
    port: dashboardConfig.redis.port,
    password: dashboardConfig.redis.password,
    maxRetriesPerRequest: 3,
  });
}
