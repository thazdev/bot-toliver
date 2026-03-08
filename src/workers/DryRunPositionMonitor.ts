/**
 * Monitor de posições dry run — roda a cada 15s quando DRY_RUN=true.
 * Atualiza preço atual, P&L, e fecha posições quando condições de saída são atingidas.
 */
import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import { DatabaseClient } from '../core/database/DatabaseClient.js';
import { getRealEntryPrice } from '../services/JupiterPriceService.js';
import {
  getOpenPositionIds,
  getPosition,
  updatePosition,
  closePosition,
  type DryRunPosition,
} from '../services/DryRunPositionService.js';

const HOLD_TIMEOUT_MS = 7_200_000; // 2 horas

function getRedis() {
  return RedisClient.getInstance().getClient();
}

async function monitorDryRunPositions(): Promise<void> {
  const isDryRun = process.env.DRY_RUN === 'true' || process.env.BOT_DRY_RUN === 'true';
  if (!isDryRun) return;

  const openIds = await getOpenPositionIds();
  if (openIds.length === 0) return;

  for (const id of openIds) {
    const position = await getPosition(id);
    if (!position || position.status !== 'open') continue;

    const currentPrice = await getRealEntryPrice(position.tokenMint);
    if (currentPrice == null || currentPrice <= 0) continue; // manter aberta se sem preço

    const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const pnlSOL = position.amountSOL * (pnlPct / 100);
    const peakPrice = Math.max(position.peakPrice, currentPrice);

    // Atualizar trailing stop após TP1
    let trailingStopPrice = position.trailingStopPrice;
    if (currentPrice >= position.tp1Price) {
      const newTrail = peakPrice * 0.88; // 12% abaixo do pico
      trailingStopPrice = Math.max(trailingStopPrice ?? 0, newTrail);
    }

    // Verificar saída
    let exitReason: string | null = null;
    if (currentPrice <= position.stopLossPrice) {
      exitReason = 'stop_loss';
    } else if (trailingStopPrice != null && currentPrice <= trailingStopPrice) {
      exitReason = 'trailing_stop';
    } else if (currentPrice >= position.tp3Price) {
      exitReason = 'tp3_hit';
    } else if (currentPrice >= position.tp2Price) {
      exitReason = 'tp2_hit';
    } else if (currentPrice >= position.tp1Price) {
      exitReason = 'tp1_hit';
    } else {
      const holdMs = Date.now() - new Date(position.entryTime).getTime();
      if (holdMs > HOLD_TIMEOUT_MS) {
        exitReason = 'time_exit';
      }
    }

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

      // Atualizar trades na DB (tabela trades)
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('DryRunPositionMonitor: DB update failed', { tokenMint: position.tokenMint, error: msg });
      }

      const holdTimeMin = (Date.now() - new Date(position.entryTime).getTime()) / 60_000;

      try {
        const redis = getRedis();
        await redis.publish(
          'bot:events',
          JSON.stringify({
            type: 'DRY_RUN_CLOSED',
            tokenMint: position.tokenMint,
            exitReason,
            pnlPct: pnlPct.toFixed(2),
            pnlSOL: pnlSOL.toFixed(4),
            amountSOL: position.amountSOL,
            holdTimeMin: holdTimeMin.toFixed(1),
          }),
        );
      } catch (_) {}

      logger.info('DRY_RUN_POSITION_CLOSED', {
        tokenMint: position.tokenMint,
        exitReason,
        entryPrice: position.entryPrice,
        exitPrice: currentPrice,
        amountSOL: position.amountSOL,
        pnlPct: pnlPct.toFixed(2) + '%',
        pnlSOL: pnlSOL.toFixed(4),
      });
    } else {
      await updatePosition(position);
    }
  }
}

let monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startDryRunPositionMonitor(): void {
  const isDryRun = process.env.DRY_RUN === 'true' || process.env.BOT_DRY_RUN === 'true';
  if (!isDryRun) return;

  if (monitorInterval) return; // já rodando

  monitorInterval = setInterval(() => {
    monitorDryRunPositions().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('DryRunPositionMonitor: error', { error: msg });
    });
  }, 15_000);

  logger.info('DryRunPositionMonitor: started (interval 15s)');
}

export function stopDryRunPositionMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info('DryRunPositionMonitor: stopped');
  }
}
