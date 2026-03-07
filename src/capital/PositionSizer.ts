import { logger } from '../utils/logger.js';
import { ExposureTracker } from '../risk/ExposureTracker.js';
import type { AppConfig } from '../types/config.types.js';

/**
 * Calculates position sizes using a Kelly-inspired sizing model.
 * Base size is scaled by strategy confidence and capped at maximum position size.
 */
export class PositionSizer {
  private maxPositionSizeSol: number;
  private exposureTracker: ExposureTracker;

  constructor(config: AppConfig, exposureTracker: ExposureTracker) {
    this.maxPositionSizeSol = config.trading.maxPositionSizeSol;
    this.exposureTracker = exposureTracker;
  }

  /**
   * Calculates position size based on strategy confidence.
   * Uses a Kelly-inspired formula: baseSize * confidence, capped at max.
   * @param strategyConfidence - Confidence score from 0 to 1
   * @returns Position size in SOL
   */
  calculatePositionSize(strategyConfidence: number): number {
    const clampedConfidence = Math.max(0, Math.min(1, strategyConfidence));
    const baseSize = this.maxPositionSizeSol * 0.5;
    let size = baseSize * clampedConfidence;

    size = Math.min(size, this.maxPositionSizeSol);

    const available = this.exposureTracker.getAvailableCapital();
    if (size > available) {
      size = available;
    }

    if (size <= 0) {
      logger.debug('PositionSizer: calculated size is zero', {
        confidence: clampedConfidence,
        available,
      });
      return 0;
    }

    logger.debug('PositionSizer: size calculated', {
      confidence: clampedConfidence,
      baseSize,
      finalSize: size,
      maxSize: this.maxPositionSizeSol,
    });

    return Math.round(size * 1_000_000_000) / 1_000_000_000;
  }
}
