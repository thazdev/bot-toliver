import { PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { CacheService } from '../core/cache/CacheService.js';
import { PRICE_CACHE_TTL_SECONDS } from '../utils/constants.js';

/**
 * Fetches and normalizes liquidity depth for a given pool.
 * Uses SOL price from cache to return USD-equivalent values.
 */
export class LiquidityScanner {
  private connectionManager: ConnectionManager;
  private cacheService: CacheService;

  constructor() {
    this.connectionManager = ConnectionManager.getInstance();
    this.cacheService = new CacheService();
  }

  /**
   * Fetches current liquidity for a pool from on-chain state.
   * @param poolAddress - The pool account address
   * @returns Normalized liquidity value in USD equivalent
   */
  async getLiquidity(poolAddress: string): Promise<number> {
    try {
      const rateLimiter = this.connectionManager.getRateLimiter();
      const connection = this.connectionManager.getConnection();

      const pubkey = new PublicKey(poolAddress);
      const accountInfo = await rateLimiter.schedule(() =>
        connection.getAccountInfo(pubkey),
      );

      if (!accountInfo || !accountInfo.data) {
        return 0;
      }

      const solReserves = this.extractSolReserves(accountInfo.data);
      const solPriceUsd = await this.getSolPriceUsd();

      return solReserves * solPriceUsd * 2;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('LiquidityScanner: failed to fetch liquidity', {
        poolAddress,
        error: errorMsg,
      });
      return 0;
    }
  }

  private extractSolReserves(data: Buffer): number {
    if (data.length < 72) {
      return 0;
    }
    try {
      const reserves = data.readBigUInt64LE(64);
      return Number(reserves) / 1_000_000_000;
    } catch {
      return 0;
    }
  }

  private async getSolPriceUsd(): Promise<number> {
    const cacheKey = CacheService.buildKey('price', 'SOL_USD');
    const cached = await this.cacheService.get<number>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const defaultPrice = 150;
    await this.cacheService.set(cacheKey, defaultPrice, PRICE_CACHE_TTL_SECONDS);
    return defaultPrice;
  }
}
