/**
 * Busca volume e tx counts via DexScreener API (token-pairs).
 * Usado para popular volumeContext quando VolumeScanner (Redis) está vazio.
 * Rate limit: 60 req/min — cache Redis 60s.
 */
import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import type { VolumeContext } from '../types/strategy.types.js';

const DEXSCREENER_API = 'https://api.dexscreener.com';
const CACHE_TTL_SEC = 60;

interface DexPair {
  baseToken?: { address: string };
  quoteToken?: { address: string };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
  };
}

export interface DexScreenerVolumeResult {
  volumeContext: Partial<VolumeContext>;
  fromApi: boolean;
}

export class DexScreenerVolumeFetcher {
  private lastErrorAt = 0;

  /**
   * Busca volume agregado do token (soma das pairs raydium/pumpfun).
   * Retorna dados parciais para popular volumeContext.
   */
  async fetchVolume(mintAddress: string): Promise<DexScreenerVolumeResult> {
    const cacheKey = `dexscreener:volume:${mintAddress}`;
    try {
      const redis = RedisClient.getInstance().getClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as DexScreenerVolumeResult;
      }
    } catch {
      // Redis falhou — continuar sem cache
    }

    try {
      const url = `${DEXSCREENER_API}/token-pairs/v1/solana/${mintAddress}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`DexScreener HTTP ${res.status}`);
      }

      const pairs = (await res.json()) as DexPair[];
      if (!Array.isArray(pairs) || pairs.length === 0) {
        return {
          volumeContext: {},
          fromApi: true,
        };
      }

      // Pairs onde o token é base ou quote
      const relevant = pairs.filter(
        (p) => p.baseToken?.address === mintAddress || p.quoteToken?.address === mintAddress,
      );

      if (relevant.length === 0) {
        return { volumeContext: {}, fromApi: true };
      }

      // Pair principal = maior volume m5 (prioriza raydium/pumpfun)
      const mainPair = relevant.reduce((best, p) => {
        const vol = p.volume?.m5 ?? 0;
        return vol > (best.volume?.m5 ?? 0) ? p : best;
      }, relevant[0]);

      const volM5 = mainPair.volume?.m5 ?? 0;
      const volH1 = mainPair.volume?.h1 ?? 0;
      const buysM5 = mainPair.txns?.m5?.buys ?? 0;
      const sellsM5 = mainPair.txns?.m5?.sells ?? 0;
      const buysH1 = mainPair.txns?.h1?.buys ?? 0;
      const sellsH1 = mainPair.txns?.h1?.sells ?? 0;

      // volume.m5/h1 estão em USD; convertemos para SOL se necessário (simplificado: usar como proxy)
      // Para momentum: volume5minAvg > 0 desbloqueia a estratégia
      const volume5minAvg = volM5;
      const volume1min = volM5 > 0 ? volM5 / 5 : 0;
      // txns.m5 = total em 5 min → buy_tx_60s = buysM5/5 (estimativa correta para 60s)
      const buyTxLast60s = Math.round(buysM5 / 5);
      const buyTxLast120s = Math.round((buysM5 * 2) / 5);
      const sellTxLast20 = sellsM5;
      const buyTxLast20 = buysM5;
      const txnsPerMinute = buysM5 + sellsM5 > 0 ? ((buysM5 + sellsM5) / 5) * 60 : 0;

      const volumeContext: Partial<VolumeContext> = {
        volume1min,
        volume5minAvg,
        buyTxLast60s,
        buyTxLast120s,
        sellTxLast20,
        buyTxLast20,
        volumeStillActive: volM5 > 0,
        volumePrev60s: volume1min,
        txnsPerMinute,
      };

      const result: DexScreenerVolumeResult = {
        volumeContext,
        fromApi: true,
      };

      try {
        const redis = RedisClient.getInstance().getClient();
        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SEC);
      } catch {
        // Non-critical
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const now = Date.now();
      if (now - this.lastErrorAt > 60_000) {
        this.lastErrorAt = now;
        logger.warn('DexScreenerVolumeFetcher: falha ao buscar volume (throttled)', {
          mint: mintAddress.slice(0, 12),
          error: msg,
        });
      }
      return {
        volumeContext: {},
        fromApi: false,
      };
    }
  }
}
