import { logger } from '../utils/logger.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { ExposureTracker } from './ExposureTracker.js';
import { PositionManager } from '../positions/PositionManager.js';
import type { TradeRequest } from '../types/trade.types.js';
import type { AppConfig } from '../types/config.types.js';

export interface RiskCheckResult {
  approved: boolean;
  reason: string;
}

/**
 * Pre-trade risk gate that validates every trade against multiple safety checks.
 */
export class RiskManager {
  private circuitBreaker: CircuitBreaker;
  private exposureTracker: ExposureTracker;
  private positionManager: PositionManager;
  private config: AppConfig;

  constructor(
    circuitBreaker: CircuitBreaker,
    exposureTracker: ExposureTracker,
    positionManager: PositionManager,
    config: AppConfig,
  ) {
    this.circuitBreaker = circuitBreaker;
    this.exposureTracker = exposureTracker;
    this.positionManager = positionManager;
    this.config = config;
  }

  /**
   * Runs all pre-trade risk checks.
   * @param tradeRequest - The trade to validate
   * @returns Approval result with reason
   */
  async preTradeCheck(tradeRequest: TradeRequest): Promise<RiskCheckResult> {
    if (tradeRequest.dryRun) {
      return { approved: true, reason: 'DRY_RUN mode active - trade will be simulated' };
    }

    if (this.circuitBreaker.isTripped()) {
      logger.warn('RiskManager: trade blocked by circuit breaker');
      return { approved: false, reason: 'Circuit breaker is tripped - all trading halted' };
    }

    const breakerTripped = await this.circuitBreaker.check();
    if (breakerTripped) {
      return { approved: false, reason: 'Daily loss threshold exceeded - circuit breaker tripped' };
    }

    if (tradeRequest.direction === 'buy') {
      const openPositions = this.positionManager.getOpenPositions();
      if (openPositions.length >= this.config.trading.maxOpenPositions) {
        return {
          approved: false,
          reason: `Max open positions reached: ${openPositions.length}/${this.config.trading.maxOpenPositions}`,
        };
      }

      if (tradeRequest.amountSol > this.config.trading.maxPositionSizeSol) {
        return {
          approved: false,
          reason: `Trade size ${tradeRequest.amountSol} SOL exceeds max position size ${this.config.trading.maxPositionSizeSol} SOL`,
        };
      }

      const availableCapital = this.exposureTracker.getAvailableCapital();
      if (tradeRequest.amountSol > availableCapital) {
        return {
          approved: false,
          reason: `Insufficient available capital: ${availableCapital.toFixed(4)} SOL (need ${tradeRequest.amountSol} SOL)`,
        };
      }

      if (this.positionManager.hasOpenPosition(tradeRequest.tokenMint)) {
        return {
          approved: false,
          reason: `Already have an open position for token ${tradeRequest.tokenMint}`,
        };
      }
    }

    logger.debug('RiskManager: trade approved', {
      tokenMint: tradeRequest.tokenMint,
      direction: tradeRequest.direction,
      amountSol: tradeRequest.amountSol,
    });

    return { approved: true, reason: 'All risk checks passed' };
  }
}
