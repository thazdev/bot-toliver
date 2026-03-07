import { logger } from '../utils/logger.js';

export interface StatsData {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  totalPnlSol: number;
  uptimeMs: number;
  tokensScanned: number;
  tradesBlocked: number;
  winRate: number;
}

/**
 * Tracks bot performance statistics in memory.
 * Provides aggregated metrics for snapshots and reporting.
 */
export class StatsTracker {
  private totalTrades: number = 0;
  private winCount: number = 0;
  private lossCount: number = 0;
  private totalPnlSol: number = 0;
  private tokensScanned: number = 0;
  private tradesBlocked: number = 0;
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Records the outcome of a trade.
   * @param won - Whether the trade was profitable
   * @param pnl - The PnL in SOL
   */
  incrementTrades(won: boolean, pnl: number): void {
    this.totalTrades++;
    this.totalPnlSol += pnl;

    if (won) {
      this.winCount++;
    } else {
      this.lossCount++;
    }
  }

  /**
   * Increments the tokens scanned counter.
   * @param count - Number of tokens scanned (default 1)
   */
  incrementTokensScanned(count: number = 1): void {
    this.tokensScanned += count;
  }

  /**
   * Increments the trades blocked counter.
   */
  incrementTradesBlocked(): void {
    this.tradesBlocked++;
  }

  /**
   * Returns the current stats snapshot.
   * @returns Aggregated StatsData
   */
  getStats(): StatsData {
    const uptimeMs = Date.now() - this.startTime;
    const winRate = this.totalTrades > 0
      ? this.winCount / this.totalTrades
      : 0;

    return {
      totalTrades: this.totalTrades,
      winCount: this.winCount,
      lossCount: this.lossCount,
      totalPnlSol: this.totalPnlSol,
      uptimeMs,
      tokensScanned: this.tokensScanned,
      tradesBlocked: this.tradesBlocked,
      winRate,
    };
  }
}
