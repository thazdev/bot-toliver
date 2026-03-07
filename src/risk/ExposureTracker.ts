import { logger } from '../utils/logger.js';
import type { AppConfig } from '../types/config.types.js';

/**
 * Tracks total SOL deployed across all open positions.
 * Provides available capital calculations.
 */
export class ExposureTracker {
  private totalExposure: number = 0;
  private totalCapital: number;

  constructor(config: AppConfig) {
    this.totalCapital = config.trading.totalCapitalSol;
  }

  /**
   * Adds to the total exposure when a position is opened.
   * @param amountSol - The SOL amount deployed
   */
  addExposure(amountSol: number): void {
    this.totalExposure += amountSol;
    logger.debug('ExposureTracker: exposure added', {
      added: amountSol,
      totalExposure: this.totalExposure,
    });
  }

  /**
   * Removes from total exposure when a position is closed.
   * @param amountSol - The SOL amount released
   */
  removeExposure(amountSol: number): void {
    this.totalExposure = Math.max(0, this.totalExposure - amountSol);
    logger.debug('ExposureTracker: exposure removed', {
      removed: amountSol,
      totalExposure: this.totalExposure,
    });
  }

  /**
   * Returns the total SOL currently deployed.
   * @returns Total exposure in SOL
   */
  getTotalExposure(): number {
    return this.totalExposure;
  }

  /**
   * Returns the available capital (total minus deployed).
   * @returns Available capital in SOL
   */
  getAvailableCapital(): number {
    return Math.max(0, this.totalCapital - this.totalExposure);
  }

  /**
   * Sets the exposure directly (used when loading state from DB).
   * @param exposureSol - Total exposure to set
   */
  setExposure(exposureSol: number): void {
    this.totalExposure = exposureSol;
  }
}
