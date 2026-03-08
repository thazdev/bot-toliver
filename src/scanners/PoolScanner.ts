import { logger } from '../utils/logger.js';
import { CacheService } from '../core/cache/CacheService.js';
import { POOL_CACHE_TTL_SECONDS } from '../utils/constants.js';
import type { PoolInfo } from '../types/pool.types.js';
import type { BaseDex } from '../dex/BaseDex.js';

/**
 * Scans Raydium and PumpFun for pool state given a token mint.
 * Caches results with a short TTL to reduce RPC load.
 */
export class PoolScanner {
  private cacheService: CacheService;
  private dexClients: BaseDex[];

  constructor(dexClients: BaseDex[]) {
    this.cacheService = new CacheService();
    this.dexClients = dexClients;
  }

  /**
   * Scans all registered DEXes for a pool containing the given mint.
   * Quando poolAddress é fornecido, usa getAccountInfo (1 crédito) em vez de getProgramAccounts (10 créditos).
   * @param mintAddress - The token mint address to search for
   * @param knownPool - Optional { poolAddress, dex } from logs — evita getProgramAccounts
   * @returns PoolInfo or null if no pool found
   */
  async scanForPool(mintAddress: string, knownPool?: { poolAddress: string; dex: 'pumpfun' | 'raydium' }): Promise<PoolInfo | null> {
    const cacheKey = CacheService.buildKey('pool', mintAddress);
    const cached = await this.cacheService.get<PoolInfo>(cacheKey);
    if (cached) {
      return cached;
    }

    if (knownPool?.poolAddress && knownPool.poolAddress.length >= 32) {
      const dex = this.dexClients.find((d) => (d as { name: string }).name.toLowerCase().includes(knownPool.dex));
      if (dex) {
        try {
          const pool = await dex.getPoolByAddress(knownPool.poolAddress);
          if (pool) {
            await this.cacheService.set(cacheKey, pool, POOL_CACHE_TTL_SECONDS);
            logger.info('PoolScanner: pool from logs (getAccountInfo)', { mintAddress, dex: knownPool.dex });
            return pool;
          }
        } catch {}
      }
    }

    for (const dex of this.dexClients) {
      try {
        const pool = await dex.getPool(mintAddress);
        if (pool) {
          await this.cacheService.set(cacheKey, pool, POOL_CACHE_TTL_SECONDS);
          logger.info('PoolScanner: pool found', {
            mintAddress,
            dex: pool.dex,
            poolAddress: pool.poolAddress,
          });
          return pool;
        }
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.debug('PoolScanner: DEX query failed', { mintAddress, error: errorMsg });
      }
    }

    logger.debug('PoolScanner: no pool found', { mintAddress });
    return null;
  }

  /**
   * Fetches pool info directly without cache.
   * @param poolAddress - The pool address to query
   * @returns PoolInfo or null
   */
  async getPoolByAddress(poolAddress: string): Promise<PoolInfo | null> {
    for (const dex of this.dexClients) {
      try {
        const pool = await dex.getPool(poolAddress);
        if (pool) {
          return pool;
        }
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.debug('PoolScanner: pool address query failed', { poolAddress, error: errorMsg });
      }
    }
    return null;
  }
}
