import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseClient } from '../DatabaseClient.js';
import { logger } from '../../../utils/logger.js';
import type { Position } from '../../../types/position.types.js';

interface PositionRow extends RowDataPacket {
  id: string;
  token_mint: string;
  entry_price_sol: number;
  exit_price_sol: number | null;
  current_price_sol: number;
  amount_sol: number;
  token_amount: string;
  status: string;
  strategy_id: string;
  stop_loss_percent: number;
  take_profit_percent: number;
  pnl_sol: number;
  pnl_percent: number;
  opened_at: Date;
  closed_at: Date | null;
}

/**
 * Repository for position data persistence.
 */
export class PositionRepository {
  private db: DatabaseClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  /**
   * Saves a new position record.
   * @param position - The Position to persist
   */
  async save(position: Position): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO positions (
          id, token_mint, entry_price_sol, exit_price_sol,
          current_price_sol, amount_sol, token_amount, status,
          strategy_id, stop_loss_percent, take_profit_percent,
          pnl_sol, pnl_percent, opened_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          position.id,
          position.tokenMint,
          position.entryPrice,
          null,
          position.currentPrice,
          position.amountSol,
          position.tokenAmount,
          position.status,
          position.strategyId,
          position.stopLoss,
          position.takeProfit,
          position.pnlSol,
          position.pnlPercent,
          position.openedAt,
          position.closedAt,
        ],
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PositionRepository save error', {
        positionId: position.id,
        error: errorMsg,
      });
      throw error;
    }
  }

  /**
   * Updates an existing position record.
   * @param position - The Position with updated fields
   */
  async update(position: Position): Promise<void> {
    try {
      await this.db.execute(
        `UPDATE positions SET
          current_price_sol = ?,
          exit_price_sol = ?,
          status = ?,
          pnl_sol = ?,
          pnl_percent = ?,
          closed_at = ?
        WHERE id = ?`,
        [
          position.currentPrice,
          position.status === 'closed' ? position.currentPrice : null,
          position.status,
          position.pnlSol,
          position.pnlPercent,
          position.closedAt,
          position.id,
        ],
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PositionRepository update error', {
        positionId: position.id,
        error: errorMsg,
      });
      throw error;
    }
  }

  /**
   * Finds all open positions.
   * @returns Array of open Position records
   */
  async findOpen(): Promise<Position[]> {
    try {
      const rows = await this.db.query<PositionRow>(
        "SELECT * FROM positions WHERE status = 'open' ORDER BY opened_at DESC",
      );
      return rows.map((row) => this.mapRowToPosition(row));
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PositionRepository findOpen error', { error: errorMsg });
      throw error;
    }
  }

  /**
   * Finds a position by ID.
   * @param id - Position UUID
   * @returns Position or null
   */
  async findById(id: string): Promise<Position | null> {
    try {
      const rows = await this.db.query<PositionRow>(
        'SELECT * FROM positions WHERE id = ?',
        [id],
      );
      if (rows.length === 0) {
        return null;
      }
      return this.mapRowToPosition(rows[0]);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PositionRepository findById error', { id, error: errorMsg });
      throw error;
    }
  }

  /**
   * Finds all positions for a given token mint.
   * @param mint - The token mint address
   * @returns Array of Position records
   */
  async findByMint(mint: string): Promise<Position[]> {
    try {
      const rows = await this.db.query<PositionRow>(
        'SELECT * FROM positions WHERE token_mint = ? ORDER BY opened_at DESC',
        [mint],
      );
      return rows.map((row) => this.mapRowToPosition(row));
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PositionRepository findByMint error', { mint, error: errorMsg });
      throw error;
    }
  }

  private mapRowToPosition(row: PositionRow): Position {
    return {
      id: row.id,
      tokenMint: row.token_mint,
      entryPrice: Number(row.entry_price_sol),
      currentPrice: Number(row.current_price_sol),
      amountSol: Number(row.amount_sol),
      tokenAmount: Number(row.token_amount),
      status: row.status as Position['status'],
      strategyId: row.strategy_id,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      pnlSol: Number(row.pnl_sol),
      pnlPercent: Number(row.pnl_percent),
      stopLoss: Number(row.stop_loss_percent),
      takeProfit: Number(row.take_profit_percent),
    };
  }
}
