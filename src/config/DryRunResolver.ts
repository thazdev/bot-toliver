import { RedisClient } from '../core/cache/RedisClient.js';
import type { AppConfig } from '../types/config.types.js';

const REDIS_KEY = 'bot:dry_run';

/**
 * Retorna o dry run efetivo: Redis tem prioridade sobre env.
 * Usado para permitir toggle via dashboard sem reiniciar o bot.
 */
export async function getEffectiveDryRun(config: AppConfig): Promise<boolean> {
  try {
    const redis = RedisClient.getInstance().getClient();
    const val = await redis.get(REDIS_KEY);
    if (val !== null && val !== undefined) {
      return val === 'true';
    }
  } catch {
    // fallback para config
  }
  return config.bot.dryRun;
}
