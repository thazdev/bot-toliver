import { RedisClient } from '../core/cache/RedisClient.js';
import type { AppConfig } from '../types/config.types.js';

const MODE_KEY = 'bot:mode';

/**
 * Returns the effective bot mode from Redis.
 * Redis stores "dry-run" or "real" in bot:mode.
 * Fallback: config.bot.dryRun (defaults to true = dry-run).
 */
export async function getEffectiveDryRun(_config?: AppConfig): Promise<boolean> {
  try {
    const redis = RedisClient.getInstance().getClient();
    const val = await redis.get(MODE_KEY);
    if (val === 'real') return false;
    if (val === 'dry-run') return true;
  } catch {
    // fallback
  }
  return true; // safe default: dry-run
}

/**
 * Sets the bot mode in Redis. Used by dashboard toggle.
 */
export async function setBotMode(mode: 'dry-run' | 'real'): Promise<void> {
  const redis = RedisClient.getInstance().getClient();
  await redis.set(MODE_KEY, mode);
  await redis.publish('bot:command', JSON.stringify({ action: 'mode_change', mode }));
}

/**
 * Gets the current bot mode string.
 */
export async function getBotMode(): Promise<'dry-run' | 'real'> {
  try {
    const redis = RedisClient.getInstance().getClient();
    const val = await redis.get(MODE_KEY);
    if (val === 'real') return 'real';
  } catch {
    // fallback
  }
  return 'dry-run';
}
