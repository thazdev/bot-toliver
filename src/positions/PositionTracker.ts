import { logger } from '../utils/logger.js';
import { PositionManager } from './PositionManager.js';
import { PnLCalculator } from './PnLCalculator.js';
import { PriceMonitor } from '../monitoring/PriceMonitor.js';
import { QueueManager } from '../core/queue/QueueManager.js';
import { QueueName } from '../types/queue.types.js';
import type { TradeExecuteJobPayload } from '../types/queue.types.js';
import type { AppConfig } from '../types/config.types.js';

/**
 * Monitors open positions for stop-loss and take-profit threshold breaches.
 * Subscribes to POSITION_MONITOR queue and enqueues sell trades when thresholds are hit.
 */
export class PositionTracker {
  private positionManager: PositionManager;
  private priceMonitor: PriceMonitor;
  private queueManager: QueueManager;
  private config: AppConfig;
  private isRunning: boolean = false;

  constructor(
    positionManager: PositionManager,
    priceMonitor: PriceMonitor,
    queueManager: QueueManager,
    config: AppConfig,
  ) {
    this.positionManager = positionManager;
    this.priceMonitor = priceMonitor;
    this.queueManager = queueManager;
    this.config = config;
  }

  /**
   * Checks all open positions against their thresholds.
   * Called by the position monitor queue worker.
   */
  async checkPositions(): Promise<void> {
    const openPositions = this.positionManager.getOpenPositions();

    for (const position of openPositions) {
      try {
        const currentPrice = await this.priceMonitor.getPrice(position.tokenMint);
        if (currentPrice === null) {
          continue;
        }

        await this.positionManager.updatePosition(position.id, currentPrice);

        const pnl = PnLCalculator.calculatePnL(position, currentPrice);

        if (pnl.pnlPercent <= -position.stopLoss) {
          logger.warn('PositionTracker: stop-loss triggered', {
            positionId: position.id,
            tokenMint: position.tokenMint,
            pnlPercent: pnl.pnlPercent.toFixed(2),
            stopLoss: position.stopLoss,
          });

          await this.enqueueSell(position.tokenMint, position.amountSol, position.strategyId);
        }

        if (pnl.pnlPercent >= position.takeProfit) {
          logger.info('PositionTracker: take-profit triggered', {
            positionId: position.id,
            tokenMint: position.tokenMint,
            pnlPercent: pnl.pnlPercent.toFixed(2),
            takeProfit: position.takeProfit,
          });

          await this.enqueueSell(position.tokenMint, position.amountSol, position.strategyId);
        }
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('PositionTracker: error checking position', {
          positionId: position.id,
          error: errorMsg,
        });
      }
    }
  }

  private async enqueueSell(tokenMint: string, amountSol: number, strategyId: string): Promise<void> {
    await this.queueManager.addJob(QueueName.TRADE_EXECUTE, 'auto-sell', {
      tradeRequest: {
        tokenMint,
        direction: 'sell',
        amountSol,
        slippageBps: this.config.trading.defaultSlippageBps,
        strategyId,
        dryRun: this.config.bot.dryRun,
      },
    } satisfies TradeExecuteJobPayload);
  }

  /**
   * Starts the position tracking loop.
   */
  start(): void {
    this.isRunning = true;
    logger.info('PositionTracker started');
  }

  /**
   * Stops the position tracking loop.
   */
  stop(): void {
    this.isRunning = false;
    logger.info('PositionTracker stopped');
  }
}
