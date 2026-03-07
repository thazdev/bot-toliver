import { logger } from '../utils/logger.js';
import { CacheService } from '../core/cache/CacheService.js';

export interface LiquidityData {
  liquiditySol: number;
  lastUpdated: number;
  poolAddress: string;
}

/**
 * Tracks liquidity changes per pool in real time.
 * Maintains in-memory state with Redis cache backing.
 */
export class LiquidityMonitor {
  private liquidityMap: Map<string, LiquidityData> = new Map();
  private cacheService: CacheService;

  constructor() {
    this.cacheService = new CacheService();
  }

  /**
   * Updates the liquidity for a given pool.
   * @param poolAddress - The pool address
   * @param liquiditySol - Current liquidity in SOL
   */
  async updateLiquidity(poolAddress: string, liquiditySol: number): Promise<void> {
    const data: LiquidityData = {
      liquiditySol,
      lastUpdated: Date.now(),
      poolAddress,
    };

    this.liquidityMap.set(poolAddress, data);

    try {
      const cacheKey = CacheService.buildKey('liquidity', poolAddress);
      await this.cacheService.set(cacheKey, data, 30);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('LiquidityMonitor: cache update failed', {
        poolAddress,
        error: errorMsg,
      });
    }
  }

  /**
   * Gets the current liquidity for a pool.
   * @param poolAddress - The pool address
   * @returns Liquidity in SOL or null
   */
  async getLiquidity(poolAddress: string): Promise<number | null> {
    const inMemory = this.liquidityMap.get(poolAddress);
    if (inMemory && Date.now() - inMemory.lastUpdated < 30_000) {
      return inMemory.liquiditySol;
    }

    try {
      const cacheKey = CacheService.buildKey('liquidity', poolAddress);
      const cached = await this.cacheService.get<LiquidityData>(cacheKey);
      if (cached) {
        this.liquidityMap.set(poolAddress, cached);
        return cached.liquiditySol;
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('LiquidityMonitor: cache read failed', {
        poolAddress,
        error: errorMsg,
      });
    }

    return null;
  }
}
