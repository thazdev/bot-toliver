import axios from 'axios';
import { RedisClient } from '../core/cache/RedisClient.js';
import { WSOL_MINT } from '../utils/constants.js';

const JUPITER_PRICE_URL = 'https://price.jup.ag/v4/price';
const PRICE_CACHE_TTL_SEC = 10;

/**
 * Obtém preço do token em SOL via Jupiter Price API v4.
 * Jupiter retorna USD; converte para SOL usando preço do WSOL.
 * Usa Redis para cache de 10s.
 */
export async function getPriceInSOL(tokenMint: string): Promise<number | null> {
  const cacheKey = `price_sol:${tokenMint}`;
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
    const ids = [tokenMint, WSOL_MINT].filter((id, i, arr) => arr.indexOf(id) === i).join(',');
    const response = await axios.get(`${JUPITER_PRICE_URL}?ids=${ids}`, {
      timeout: 5000,
    });
    const tokenPriceUsd = response.data?.data?.[tokenMint]?.price;
    const solPriceUsd = response.data?.data?.[WSOL_MINT]?.price;
    if (
      typeof tokenPriceUsd === 'number' &&
      tokenPriceUsd > 0 &&
      typeof solPriceUsd === 'number' &&
      solPriceUsd > 0
    ) {
      const priceSol = tokenPriceUsd / solPriceUsd;
      try {
        const redis = RedisClient.getInstance().getClient();
        await redis.set(cacheKey, priceSol.toString(), 'EX', PRICE_CACHE_TTL_SEC);
      } catch {
        // Non-critical
      }
      return priceSol;
    }
  } catch {
    // Silencioso — fallback será usado
  }
  return null;
}

/**
 * @deprecated Use getPriceInSOL para preço consistente em SOL.
 * Mantido para compatibilidade — retorna preço em SOL quando possível.
 */
export async function getRealEntryPrice(tokenMint: string): Promise<number | null> {
  return getPriceInSOL(tokenMint);
}
