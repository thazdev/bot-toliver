import { RedisClient } from '../core/cache/RedisClient.js';

const REDIS_KEY = 'bot:buys_paused';

let cached: boolean | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 3000;

/**
 * Retorna true se as compras estão pausadas.
 * Quando true, o bot NÃO abre novas posições, mas continua
 * monitorando e vendendo as posições já abertas.
 */
export async function areBuysPaused(): Promise<boolean> {
  const now = Date.now();
  if (cached !== null && now < cacheExpiry) {
    return cached;
  }
  try {
    const redis = RedisClient.getInstance().getClient();
    const val = await redis.get(REDIS_KEY);
    cached = val === 'true';
  } catch {
    cached = false;
  }
  cacheExpiry = now + CACHE_TTL_MS;
  return cached;
}

export function invalidateBuysPausedCache(): void {
  cached = null;
}

export async function areBuysPausedNoCache(): Promise<boolean> {
  invalidateBuysPausedCache();
  return areBuysPaused();
}
