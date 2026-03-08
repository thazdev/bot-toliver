import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { StatsTracker } from './StatsTracker.js';
import { StatsRepository } from '../core/database/repositories/StatsRepository.js';
import { STATS_SNAPSHOT_INTERVAL_CRON } from '../utils/constants.js';

/**
 * Periodically saves bot performance stats to the database.
 * Uses node-cron to schedule snapshots every 15 minutes.
 */
export class StatsSnapshot {
  private statsTracker: StatsTracker;
  private statsRepository: StatsRepository;
  private cronJob: cron.ScheduledTask | null = null;

  constructor(statsTracker: StatsTracker) {
    this.statsTracker = statsTracker;
    this.statsRepository = new StatsRepository();
  }

  /**
   * Starts the periodic snapshot cron job.
   */
  start(): void {
    this.cronJob = cron.schedule(STATS_SNAPSHOT_INTERVAL_CRON, async () => {
      await this.takeSnapshot();
    });

    logger.debug('StatsSnapshot cron started', { schedule: STATS_SNAPSHOT_INTERVAL_CRON });
  }

  /**
   * Takes a snapshot of current stats and saves to DB.
   */
  async takeSnapshot(): Promise<void> {
    try {
      const stats = this.statsTracker.getStats();

      await this.statsRepository.saveSnapshot({
        totalTrades: stats.totalTrades,
        winCount: stats.winCount,
        lossCount: stats.lossCount,
        totalPnlSol: stats.totalPnlSol,
        winRate: stats.winRate,
        tokensScanned: stats.tokensScanned,
        tradesBlocked: stats.tradesBlocked,
        uptimeSeconds: Math.floor(stats.uptimeMs / 1000),
      });

      logger.debug('Stats snapshot saved', {
        totalTrades: stats.totalTrades,
        winRate: (stats.winRate * 100).toFixed(1) + '%',
        totalPnl: stats.totalPnlSol.toFixed(4),
      });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('StatsSnapshot: failed to save', { error: errorMsg });
    }
  }

  /**
   * Stops the cron job.
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.debug('StatsSnapshot cron stopped');
    }
  }
}
