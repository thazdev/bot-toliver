/**
 * Monitor de posições dry run — roda a cada 5s quando bot está em modo dry-run.
 * Atualiza preço atual, P&L, e fecha posições quando condições de saída são atingidas.
 * Publica tudo no Redis pub/sub (bot:events) para o dashboard consumir via Socket.io.
 */
import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import { DatabaseClient } from '../core/database/DatabaseClient.js';
import { getPriceInSOL } from '../services/JupiterPriceService.js';
import { getEffectiveDryRun } from '../config/DryRunResolver.js';
import {
  getOpenPositionIds,
  getPosition,
  updatePosition,
  closePosition,
  listOpenPositions,
  listClosedPositions,
  getOpenPositionsTotalSOL,
  type DryRunPosition,
} from '../services/DryRunPositionService.js';
import type { PoolScanner } from '../scanners/PoolScanner.js';

const MONITOR_INTERVAL_MS = 5_000; // 5s — fast enough for volatile tokens
const HOLD_TIMEOUT_MS = 7_200_000; // 2 hours max hold
const QUICK_EXIT_WINDOW_MS = 60_000; // first 60 seconds
const QUICK_EXIT_LOSS_PCT = -5; // exit if down >5% within first 60s
const TOTAL_CAPITAL_SOL = parseFloat(process.env.TOTAL_CAPITAL_SOL ?? '0.9');

export type DryRunMonitorOptions = {
  poolScanner?: PoolScanner | null;
};

let priceFallback: ((tokenMint: string) => Promise<number | null>) | null = null;

export function setDryRunPriceFallback(fn: (tokenMint: string) => Promise<number | null>): void {
  priceFallback = fn;
}

function getRedis() {
  return RedisClient.getInstance().getClient();
}

async function getCurrentPrice(tokenMint: string): Promise<number | null> {
  const fromJupiter = await getPriceInSOL(tokenMint);
  if (fromJupiter != null && fromJupiter > 0) return fromJupiter;
  if (priceFallback) {
    const fromPool = await priceFallback(tokenMint);
    if (fromPool != null && fromPool > 0) return fromPool;
  }
  return null;
}

async function publishSnapshot(): Promise<void> {
  try {
    const redis = getRedis();
    const open = await listOpenPositions();
    const closed = await listClosedPositions(20);
    const capitalInUse = await getOpenPositionsTotalSOL();
    const totalPnl = closed.reduce((s, p) => s + (p.finalPnlSOL ?? 0), 0);
    const wins = closed.filter((p) => (p.finalPnlSOL ?? 0) > 0).length;
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    const pnlPercents = closed.map((p) => p.finalPnlPct ?? 0).filter((x) => isFinite(x));
    const bestTrade = pnlPercents.length > 0 ? Math.max(...pnlPercents) : 0;
    const worstTrade = pnlPercents.length > 0 ? Math.min(...pnlPercents) : 0;
    const holdTimes = closed
      .filter((p) => p.entryTime && p.exitTime)
      .map((p) => (new Date(p.exitTime!).getTime() - new Date(p.entryTime!).getTime()) / 60_000);
    const avgHoldMin = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;

    await redis.publish(
      'bot:events',
      JSON.stringify({
        type: 'DRY_RUN_UPDATE',
        openPositions: open,
        closedPositions: closed,
        summary: {
          totalCapitalSOL: TOTAL_CAPITAL_SOL,
          capitalInUse,
          capitalInUsePct: TOTAL_CAPITAL_SOL > 0 ? (capitalInUse / TOTAL_CAPITAL_SOL) * 100 : 0,
          availableCapital: Math.max(0, TOTAL_CAPITAL_SOL - capitalInUse),
          totalPnlSOL: totalPnl,
          winRate,
          bestTrade,
          worstTrade,
          avgHoldMin,
          openCount: open.length,
          closedCount: closed.length,
        },
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (_) {}
}

/**
 * Determine exit reason based on current price, position state and time held.
 * Implements:
 *  - Quick-exit: down >5% within first 60s
 *  - Hard stop loss
 *  - Trailing stop (activates after TP1)
 *  - Take-profit levels (progressive, NOT selling immediately at TP1)
 *  - Time-based exit after 2h
 */
function determineExitReason(position: DryRunPosition, currentPrice: number, pnlPct: number): string | null {
  const holdMs = Date.now() - new Date(position.entryTime).getTime();

  // QUICK EXIT: if down >5% within first 60 seconds, cut losses fast
  if (holdMs < QUICK_EXIT_WINDOW_MS && pnlPct <= QUICK_EXIT_LOSS_PCT) {
    return 'quick_exit';
  }

  // HARD STOP LOSS
  if (currentPrice <= position.stopLossPrice) {
    return 'stop_loss';
  }

  // TRAILING STOP (only active after TP1 is reached)
  if (position.trailingStopPrice != null && position.trailingStopPrice > 0 && currentPrice <= position.trailingStopPrice) {
    return 'trailing_stop';
  }

  // TP3: sell all remaining (full exit)
  if (currentPrice >= position.tp3Price) {
    return 'tp3_hit';
  }

  // TP1/TP2: don't sell immediately — we rely on trailing stop to protect gains
  // The trailing stop will be updated in the main loop when price >= tp1

  // TIME EXIT: 2 hours max hold
  if (holdMs > HOLD_TIMEOUT_MS) {
    return 'time_exit';
  }

  return null;
}

async function monitorDryRunPositions(): Promise<void> {
  const isDryRun = await getEffectiveDryRun();
  if (!isDryRun) return;

  const openIds = await getOpenPositionIds();
  if (openIds.length === 0) {
    await publishSnapshot();
    return;
  }

  for (const id of openIds) {
    const position = await getPosition(id);
    if (!position || position.status !== 'open') continue;

    const currentPrice = await getCurrentPrice(position.tokenMint);
    if (currentPrice == null || currentPrice <= 0) {
      // Can't get price — check if we should quick-exit based on time alone
      const holdMs = Date.now() - new Date(position.entryTime).getTime();
      if (holdMs > HOLD_TIMEOUT_MS) {
        // Time exit even without price — use entry price as fallback
        position.status = 'closed';
        position.exitPrice = position.entryPrice;
        position.exitReason = 'time_exit_no_price';
        position.exitTime = new Date().toISOString();
        position.finalPnlPct = 0;
        position.finalPnlSOL = 0;
        await closePosition(position);
        continue;
      }
      // Keep position at entry price, no exit check
      position.currentPrice = position.entryPrice;
      position.currentPnlPct = 0;
      position.currentPnlSOL = 0;
      await updatePosition(position);
      continue;
    }

    const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const pnlSOL = position.amountSOL * (pnlPct / 100);
    const peakPrice = Math.max(position.peakPrice, currentPrice);

    // Progressive trailing stop:
    // - After TP1: trail at 12% below peak (lock in some gains)
    // - After TP2: tighten trail to 8% below peak
    // - After TP3: tighten trail to 5% below peak
    let trailingStopPrice = position.trailingStopPrice;
    if (currentPrice >= position.tp2Price) {
      // Tight trail after TP2
      const newTrail = peakPrice * 0.92;
      trailingStopPrice = Math.max(trailingStopPrice ?? 0, newTrail);
    } else if (currentPrice >= position.tp1Price) {
      // Standard trail after TP1 — lock in at least break-even
      const newTrail = Math.max(peakPrice * 0.88, position.entryPrice * 1.02);
      trailingStopPrice = Math.max(trailingStopPrice ?? 0, newTrail);
    }

    // Break-even stop: if we ever reached +8%, move stop to entry price
    const gainFromEntry = ((peakPrice - position.entryPrice) / position.entryPrice) * 100;
    if (gainFromEntry >= 8 && (trailingStopPrice == null || trailingStopPrice < position.entryPrice)) {
      trailingStopPrice = position.entryPrice;
    }

    const exitReason = determineExitReason(position, currentPrice, pnlPct);

    position.currentPrice = currentPrice;
    position.currentPnlPct = pnlPct;
    position.currentPnlSOL = pnlSOL;
    position.peakPrice = peakPrice;
    position.trailingStopPrice = trailingStopPrice;

    if (exitReason) {
      position.status = 'closed';
      position.exitPrice = currentPrice;
      position.exitReason = exitReason;
      position.exitTime = new Date().toISOString();
      position.finalPnlPct = pnlPct;
      position.finalPnlSOL = pnlSOL;

      await closePosition(position);

      try {
        const db = DatabaseClient.getInstance();
        const rows = await db.query<{ id: number } & import('mysql2/promise').RowDataPacket>(
          'SELECT id FROM trades WHERE token_mint = ? AND status = ? AND direction = ? ORDER BY id DESC LIMIT 1',
          [position.tokenMint, 'dry_run', 'buy'],
        );
        const row = rows[0];
        if (row?.id) {
          await db.execute(
            `UPDATE trades SET
              status = 'dry_run_closed',
              exit_price_sol = ?,
              exit_reason = ?,
              pnl_sol = ?,
              pnl_pct = ?,
              closed_at = NOW()
            WHERE id = ?`,
            [currentPrice, exitReason, pnlSOL, pnlPct, row.id],
          );
        }
      } catch (_) {}

      try {
        const redis = getRedis();
        await redis.publish(
          'bot:events',
          JSON.stringify({
            type: 'DRY_RUN_SELL',
            tokenMint: position.tokenMint,
            exitReason,
            pnlPct: pnlPct.toFixed(2),
            pnlSOL: pnlSOL.toFixed(4),
            amountSOL: position.amountSOL,
            entryPrice: position.entryPrice,
            exitPrice: currentPrice,
            positionId: position.id,
            timestamp: new Date().toISOString(),
          }),
        );
      } catch (_) {}

      logger.debug('DRY_RUN_SELL', {
        tokenMint: position.tokenMint,
        exitReason,
        pnlPct: pnlPct.toFixed(2) + '%',
        pnlSOL: pnlSOL.toFixed(4),
      });
    } else {
      await updatePosition(position);
    }
  }

  await publishSnapshot();
}

let monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startDryRunPositionMonitor(options?: DryRunMonitorOptions): void {
  if (monitorInterval) return;

  if (options?.poolScanner) {
    setDryRunPriceFallback((mint) =>
      options.poolScanner!.scanForPool(mint).then((p) => (p?.price != null ? p.price : null)),
    );
  }

  monitorInterval = setInterval(() => {
    monitorDryRunPositions().catch(() => {});
  }, MONITOR_INTERVAL_MS);

  monitorDryRunPositions().catch(() => {});
}

export function stopDryRunPositionMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
