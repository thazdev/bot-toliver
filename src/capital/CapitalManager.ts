import { logger } from '../utils/logger.js';
import type { AppConfig } from '../types/config.types.js';

/**
 * Manages total tradeable capital allocation and release.
 * Tracks how much capital is allocated vs available.
 */
export class CapitalManager {
  private totalCapital: number;
  private allocatedCapital: number = 0;

  constructor(config: AppConfig) {
    this.totalCapital = config.trading.totalCapitalSol;
    logger.info('CapitalManager initialized', { totalCapitalSol: this.totalCapital });
  }

  /**
   * Allocates capital for a new position.
   * @param amount - Amount in SOL to allocate
   * @returns True if allocation succeeded
   */
  allocateCapital(amount: number): boolean {
    if (amount <= 0) {
      return false;
    }

    if (this.allocatedCapital + amount > this.totalCapital) {
      logger.warn('CapitalManager: insufficient capital for allocation', {
        requested: amount,
        allocated: this.allocatedCapital,
        total: this.totalCapital,
      });
      return false;
    }

    this.allocatedCapital += amount;
    logger.debug('Capital allocated', {
      amount,
      totalAllocated: this.allocatedCapital,
      available: this.getAvailableCapital(),
    });
    return true;
  }

  /**
   * Releases capital when a position is closed.
   * @param amount - Amount in SOL to release
   */
  releaseCapital(amount: number): void {
    this.allocatedCapital = Math.max(0, this.allocatedCapital - amount);
    logger.debug('Capital released', {
      amount,
      totalAllocated: this.allocatedCapital,
      available: this.getAvailableCapital(),
    });
  }

  /**
   * Returns the available (unallocated) capital.
   * @returns Available capital in SOL
   */
  getAvailableCapital(): number {
    return Math.max(0, this.totalCapital - this.allocatedCapital);
  }

  /**
   * Returns the total allocated capital.
   * @returns Allocated capital in SOL
   */
  getAllocatedCapital(): number {
    return this.allocatedCapital;
  }

  /**
   * Returns the total configured capital.
   * @returns Total capital in SOL
   */
  getTotalCapital(): number {
    return this.totalCapital;
  }
}
