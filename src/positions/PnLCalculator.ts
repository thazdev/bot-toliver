import BN from 'bn.js';
import type { Position } from '../types/position.types.js';

export interface PnLResult {
  pnlSol: number;
  pnlPercent: number;
}

/**
 * Calculates realized and unrealized PnL for positions.
 * Uses BN.js for precision in all financial calculations.
 */
export class PnLCalculator {
  private static readonly PRECISION = new BN(1_000_000_000);

  /**
   * Calculates the PnL for a single position given a current price.
   * @param position - The position to calculate PnL for
   * @param currentPrice - Current token price in SOL
   * @returns PnL in SOL and as a percentage
   */
  static calculatePnL(position: Position, currentPrice: number): PnLResult {
    const entryBN = new BN(Math.round(position.entryPrice * 1_000_000_000));
    const currentBN = new BN(Math.round(currentPrice * 1_000_000_000));
    const amountBN = new BN(Math.round(position.amountSol * 1_000_000_000));

    if (entryBN.isZero()) {
      return { pnlSol: 0, pnlPercent: 0 };
    }

    const priceDiff = currentBN.sub(entryBN);
    const pnlBN = priceDiff.mul(amountBN).div(entryBN);
    const pnlSol = pnlBN.toNumber() / 1_000_000_000;

    const pnlPercent = entryBN.isZero()
      ? 0
      : (priceDiff.toNumber() / entryBN.toNumber()) * 100;

    return { pnlSol, pnlPercent };
  }

  /**
   * Calculates total unrealized PnL across all open positions.
   * @param positions - Array of open positions (must have currentPrice set)
   * @returns Total unrealized PnL in SOL
   */
  static calculateUnrealizedPnL(positions: Position[]): number {
    let totalPnlBN = new BN(0);

    for (const position of positions) {
      if (position.status !== 'open') continue;

      const entryBN = new BN(Math.round(position.entryPrice * 1_000_000_000));
      const currentBN = new BN(Math.round(position.currentPrice * 1_000_000_000));
      const amountBN = new BN(Math.round(position.amountSol * 1_000_000_000));

      if (entryBN.isZero()) continue;

      const priceDiff = currentBN.sub(entryBN);
      const pnlBN = priceDiff.mul(amountBN).div(entryBN);
      totalPnlBN = totalPnlBN.add(pnlBN);
    }

    return totalPnlBN.toNumber() / 1_000_000_000;
  }
}
