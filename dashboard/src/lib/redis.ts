import Redis from 'ioredis';
import { dashboardConfig } from '@/config/dashboard.config';

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

const redisInstance =
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

redisInstance.on('error', () => {}); // Evita crash quando Redis inacessível (ex: railway.internal fora da rede)

export const redis = redisInstance;

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

export function createRedisSubscriber() {
  const r = dashboardConfig.redis.url
    ? new Redis(dashboardConfig.redis.url!, { maxRetriesPerRequest: 3 })
    : new Redis({
        host: dashboardConfig.redis.host,
        port: dashboardConfig.redis.port,
        password: dashboardConfig.redis.password,
        maxRetriesPerRequest: 3,
      });
  r.on('error', () => {});
  return r;
}
