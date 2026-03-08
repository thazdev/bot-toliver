import { DatabaseClient } from '../core/database/DatabaseClient.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import { logger } from './logger.js';

export type TradeAction = 'BUY' | 'SELL' | 'SKIP' | 'BLOCKED' | 'EXIT';

export interface TradeLogEntry {
  tokenMint: string;
  action: TradeAction;
  priceSol?: number;
  amountSol?: number;
  pnlSol?: number;
  pnlPct?: number;
  mode: 'dry_run' | 'real';
  strategyId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Grava logs de transação de forma estruturada no MySQL e no Redis.
 * MySQL: tabela trade_logs (persistência para dashboard)
 * Redis: lista trade_logs:recent (últimos 100, para leitura rápida)
 */
export async function logTrade(entry: TradeLogEntry): Promise<void> {
  const now = new Date();

  try {
    const db = DatabaseClient.getInstance();
    await db.execute(
      `INSERT INTO trade_logs (timestamp, token_mint, action, price_sol, amount_sol, pnl_sol, pnl_pct, mode, strategy_id, reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        now,
        entry.tokenMint,
        entry.action,
        entry.priceSol ?? 0,
        entry.amountSol ?? 0,
        entry.pnlSol ?? null,
        entry.pnlPct ?? null,
        entry.mode,
        entry.strategyId ?? '',
        entry.reason ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('tradeLogger: MySQL write failed', { error: msg, token: entry.tokenMint });
  }

  try {
    const redis = RedisClient.getInstance().getClient();
    const redisEntry = JSON.stringify({
      ...entry,
      timestamp: now.toISOString(),
    });
    await redis.lpush('trade_logs:recent', redisEntry);
    await redis.ltrim('trade_logs:recent', 0, 99);
  } catch {
    // Non-critical
  }
}
