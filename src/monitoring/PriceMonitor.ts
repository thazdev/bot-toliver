import { logger } from '../utils/logger.js';
import { CacheService } from '../core/cache/CacheService.js';
import { PRICE_CACHE_TTL_SECONDS } from '../utils/constants.js';

export interface PriceData {
  price: number;
  lastUpdated: number;
  source: string;
}

/**
 * Real-time price tracking service for tokens.
 * Maintains an in-memory price map with Redis as a secondary cache.
 */
export class PriceMonitor {
  private prices: Map<string, PriceData> = new Map();
  private cacheService: CacheService;

  constructor() {
    this.cacheService = new CacheService();
  }

  /**
   * Updates the price for a given token mint.
   * @param mintAddress - The token mint address
   * @param price - The new price in SOL
   * @param source - The source of the price data
   */
  async updatePrice(mintAddress: string, price: number, source: string): Promise<void> {
    const priceData: PriceData = {
      price,
      lastUpdated: Date.now(),
      source,
    };

    this.prices.set(mintAddress, priceData);

    try {
      const cacheKey = CacheService.buildKey('price', mintAddress);
      await this.cacheService.set(cacheKey, priceData, PRICE_CACHE_TTL_SECONDS);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PriceMonitor: failed to update Redis cache', {
        mintAddress,
        error: errorMsg,
      });
    }
  }

  /**
   * Gets the current price for a token mint.
   * Falls back to Redis cache if not in memory.
   * @param mintAddress - The token mint address
   * @returns Price in SOL or null if unknown
   */
  async getPrice(mintAddress: string): Promise<number | null> {
    const inMemory = this.prices.get(mintAddress);
    if (inMemory) {
      const ageMs = Date.now() - inMemory.lastUpdated;
      if (ageMs < PRICE_CACHE_TTL_SECONDS * 1000) {
        return inMemory.price;
      }
    }

    try {
      const cacheKey = CacheService.buildKey('price', mintAddress);
      const cached = await this.cacheService.get<PriceData>(cacheKey);
      if (cached) {
        this.prices.set(mintAddress, cached);
        return cached.price;
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PriceMonitor: failed to read Redis cache', {
        mintAddress,
        error: errorMsg,
      });
    }

    return null;
  }

  /**
   * Returns the full in-memory price map.
   * @returns Map of mint addresses to PriceData
   */
  getAllPrices(): Map<string, PriceData> {
    return new Map(this.prices);
  }

  /**
   * Clears all in-memory price data.
   */
  clear(): void {
    this.prices.clear();
  }
}
