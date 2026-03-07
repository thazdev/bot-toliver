import { logger } from '../utils/logger.js';
import type { AppConfig } from '../types/config.types.js';

/**
 * Calculates dynamic slippage based on pool liquidity.
 * Low liquidity pools get higher slippage tolerance, high liquidity pools get tighter slippage.
 */
export class SlippageManager {
  private defaultSlippageBps: number;
  private maxSlippageBps: number;

  constructor(config: AppConfig) {
    this.defaultSlippageBps = config.trading.defaultSlippageBps;
    this.maxSlippageBps = Math.min(config.trading.defaultSlippageBps * 3, 5000);
  }

  /**
   * Calculates the optimal slippage for a trade based on pool liquidity.
   * @param liquiditySol - The pool's liquidity in SOL
   * @param tradeSizeSol - The trade size in SOL
   * @returns Slippage in basis points
   */
  calculateSlippage(liquiditySol: number, tradeSizeSol: number): number {
    if (liquiditySol <= 0) {
      logger.warn('SlippageManager: zero liquidity, using max slippage');
      return this.maxSlippageBps;
    }

    const tradeToLiquidityRatio = tradeSizeSol / liquiditySol;

    let slippageBps: number;

    if (tradeToLiquidityRatio < 0.001) {
      slippageBps = this.defaultSlippageBps * 0.5;
    } else if (tradeToLiquidityRatio < 0.01) {
      slippageBps = this.defaultSlippageBps;
    } else if (tradeToLiquidityRatio < 0.05) {
      slippageBps = this.defaultSlippageBps * 1.5;
    } else if (tradeToLiquidityRatio < 0.1) {
      slippageBps = this.defaultSlippageBps * 2;
    } else {
      slippageBps = this.maxSlippageBps;
    }

    slippageBps = Math.round(Math.min(slippageBps, this.maxSlippageBps));

    logger.debug('SlippageManager: calculated slippage', {
      liquiditySol,
      tradeSizeSol,
      ratio: tradeToLiquidityRatio.toFixed(4),
      slippageBps,
    });

    return slippageBps;
  }
}
