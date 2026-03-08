import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseClient } from '../DatabaseClient.js';
import { logger } from '../../../utils/logger.js';
import type { TradeResult } from '../../../types/trade.types.js';

interface TradeRow extends RowDataPacket {
  id: number;
  token_mint: string;
  direction: string;
  status: string;
  amount_sol: number;
  output_amount: string;
  price_sol: number;
  price_impact_percent: number;
  fee_sol: number;
  tx_signature: string | null;
  strategy_id: string;
  dry_run: boolean;
  error_message: string | null;
  executed_at: Date;
}

/**
 * Repository for trade data persistence.
 */
export class TradeRepository {
  private db: DatabaseClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  /**
   * Inserts a new trade record.
   * @param trade - The TradeResult to persist
   */
  async insert(trade: TradeResult): Promise<void> {
    try {
      const rawPriceSol =
        trade.inputAmount > 0 && isFinite(trade.outputAmount)
          ? trade.outputAmount / trade.inputAmount
          : 0;
      const safePriceSol =
        typeof rawPriceSol === 'number' &&
        isFinite(rawPriceSol) &&
        rawPriceSol > 0 &&
        rawPriceSol <= 999_999.999
        ? rawPriceSol
        : 0.000001;

      const safeAmountSol = isFinite(trade.tradeRequest.amountSol)
        ? trade.tradeRequest.amountSol
        : 0;
      const safeOutputAmount = isFinite(trade.outputAmount) ? trade.outputAmount : 0;
      const safePriceImpact = isFinite(trade.priceImpact) ? trade.priceImpact : 0;
      const safeFee = isFinite(trade.fee) ? trade.fee : 0;

      await this.db.execute(
        `INSERT INTO trades (
          token_mint, direction, status, amount_sol, output_amount,
          price_sol, price_impact_percent, fee_sol, tx_signature,
          strategy_id, dry_run, error_message, executed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.tradeRequest.tokenMint,
          trade.tradeRequest.direction,
          trade.status,
          safeAmountSol,
          safeOutputAmount,
          safePriceSol,
          safePriceImpact,
          safeFee,
          trade.txSignature,
          trade.tradeRequest.strategyId,
          trade.tradeRequest.dryRun,
          trade.error,
          trade.executedAt,
        ],
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TradeRepository insert error', {
        tokenMint: trade.tradeRequest.tokenMint,
        error: errorMsg,
      });
      throw error;
    }
  }

  /**
   * Finds all trades for a given token mint.
   * @param mint - The token mint address
   * @returns Array of TradeResult
   */
  async findByMint(mint: string): Promise<TradeResult[]> {
    try {
      const rows = await this.db.query<TradeRow>(
        'SELECT * FROM trades WHERE token_mint = ? ORDER BY executed_at DESC',
        [mint],
      );

      return rows.map((row) => this.mapRowToTrade(row));
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TradeRepository findByMint error', { mint, error: errorMsg });
      throw error;
    }
  }

  /**
   * Calculates the total daily loss (sum of negative PnL for today's closed sell trades).
   * @returns The cumulative daily loss in SOL (positive number)
   */
  async getDailyLoss(): Promise<number> {
    try {
      const rows = await this.db.query<{ daily_loss: number } & RowDataPacket>(
        `SELECT COALESCE(SUM(
          CASE WHEN direction = 'sell' AND status = 'confirmed'
            THEN amount_sol - output_amount
            ELSE 0
          END
        ), 0) as daily_loss
        FROM trades
        WHERE DATE(executed_at) = CURDATE()
          AND status = 'confirmed'`,
      );

      const loss = Number(rows[0]?.daily_loss ?? 0);
      return Math.abs(loss);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TradeRepository getDailyLoss error', { error: errorMsg });
      return 0;
    }
  }

  private mapRowToTrade(row: TradeRow): TradeResult {
    return {
      tradeRequest: {
        tokenMint: row.token_mint,
        direction: row.direction as TradeResult['tradeRequest']['direction'],
        amountSol: Number(row.amount_sol),
        slippageBps: 0,
        strategyId: row.strategy_id,
        dryRun: Boolean(row.dry_run),
      },
      txSignature: row.tx_signature,
      status: row.status as TradeResult['status'],
      inputAmount: Number(row.amount_sol),
      outputAmount: Number(row.output_amount),
      priceImpact: Number(row.price_impact_percent),
      fee: Number(row.fee_sol),
      executedAt: row.executed_at,
      error: row.error_message,
    };
  }
}
