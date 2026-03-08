import axios from 'axios';
import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';

const JUPITER_PRICE_URL = 'https://price.jup.ag/v4/price';
const PRICE_CACHE_TTL_SEC = 10;

/**
 * Obtém preço real do token via Jupiter Price API v4.
 * Usa Redis para cache de 10s.
 */
export async function getRealEntryPrice(tokenMint: string): Promise<number | null> {
  const cacheKey = `price:${tokenMint}`;
  try {
    const redis = RedisClient.getInstance().getClient();
    const cached = await redis.get(cacheKey);
    if (cached) {
      const val = parseFloat(cached);
      return isFinite(val) && val > 0 ? val : null;
    }
  } catch {
    // Redis falhou — continuar sem cache
  }

  try {
    const response = await axios.get(`${JUPITER_PRICE_URL}?ids=${tokenMint}`, {
      timeout: 5000,
    });
    const price = response.data?.data?.[tokenMint]?.price;
    if (typeof price === 'number' && price > 0) {
      try {
        const redis = RedisClient.getInstance().getClient();
        await redis.set(cacheKey, price.toString(), 'EX', PRICE_CACHE_TTL_SEC);
      } catch {
        // Non-critical
      }
      return price;
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.debug('JupiterPriceService: fetch failed', { tokenMint: tokenMint.slice(0, 12), error: msg });
  }
  return null;
}
