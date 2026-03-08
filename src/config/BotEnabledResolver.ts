import { RedisClient } from '../core/cache/RedisClient.js';

const REDIS_KEY = 'bot:enabled';

/** Cache por 5s para evitar muitas leituras Redis */
let cached: boolean | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5000;

/**
 * Retorna se o bot está ativo (deve processar tokens).
 * Quando false, listeners não enfileiram jobs e workers retornam cedo.
 * Redis tem prioridade; default true (backwards compat).
 */
export async function isBotEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cached !== null && now < cacheExpiry) {
    return cached;
  }
  try {
    const redis = RedisClient.getInstance().getClient();
    const val = await redis.get(REDIS_KEY);
    if (val !== null && val !== undefined) {
      cached = val === 'true';
    } else {
      cached = true; // default: ativo
    }
  } catch {
    cached = true;
  }
  cacheExpiry = now + CACHE_TTL_MS;
  return cached;
}

/** Invalida o cache (ex.: após toggle no dashboard) */
export function invalidateBotEnabledCache(): void {
  cached = null;
}

/** Força leitura do Redis ignorando cache (para reação rápida ao toggle) */
export async function isBotEnabledNoCache(): Promise<boolean> {
  invalidateBotEnabledCache();
  return isBotEnabled();
}
