import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseClient } from '../DatabaseClient.js';
import { logger } from '../../../utils/logger.js';

export interface StatsSnapshotRow {
  id: number;
  total_trades: number;
  win_count: number;
  loss_count: number;
  total_pnl_sol: number;
  win_rate: number;
  tokens_scanned: number;
  trades_blocked: number;
  uptime_seconds: number;
  snapshot_at: Date;
}

export interface StatsSnapshotData {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  totalPnlSol: number;
  winRate: number;
  tokensScanned: number;
  tradesBlocked: number;
  uptimeSeconds: number;
}

/**
 * Repository for bot performance stats snapshots.
 */
export class StatsRepository {
  private db: DatabaseClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  /**
   * Saves a performance stats snapshot to the database.
   * @param snapshot - The snapshot data to persist
   */
  async saveSnapshot(snapshot: StatsSnapshotData): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO stats (
          total_trades, win_count, loss_count, total_pnl_sol,
          win_rate, tokens_scanned, trades_blocked, uptime_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.totalTrades,
          snapshot.winCount,
          snapshot.lossCount,
          snapshot.totalPnlSol,
          snapshot.winRate,
          snapshot.tokensScanned,
          snapshot.tradesBlocked,
          snapshot.uptimeSeconds,
        ],
      );
      logger.debug('Stats snapshot saved');
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('StatsRepository saveSnapshot error', { error: errorMsg });
      throw error;
    }
  }

  /**
   * Retrieves the latest stats snapshot.
   * @returns The most recent StatsSnapshotData or null
   */
  async getLatest(): Promise<StatsSnapshotData | null> {
    try {
      const rows = await this.db.query<StatsSnapshotRow & RowDataPacket>(
        'SELECT * FROM stats ORDER BY snapshot_at DESC LIMIT 1',
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];
      return {
        totalTrades: row.total_trades,
        winCount: row.win_count,
        lossCount: row.loss_count,
        totalPnlSol: Number(row.total_pnl_sol),
        winRate: Number(row.win_rate),
        tokensScanned: row.tokens_scanned,
        tradesBlocked: row.trades_blocked,
        uptimeSeconds: Number(row.uptime_seconds),
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('StatsRepository getLatest error', { error: errorMsg });
      return null;
    }
  }
}
