import { logger } from '../utils/logger.js';
import { TradeRepository } from '../core/database/repositories/TradeRepository.js';
import { QueueManager } from '../core/queue/QueueManager.js';
import { QueueName } from '../types/queue.types.js';
import type { AlertJobPayload } from '../types/queue.types.js';
import type { AppConfig } from '../types/config.types.js';

/**
 * Circuit breaker that halts all trading when daily loss threshold is exceeded.
 * Checks cumulative daily realized loss from the trade repository.
 */
export class CircuitBreaker {
  private tripped: boolean = false;
  private maxDailyLossSol: number;
  private tradeRepository: TradeRepository;
  private queueManager: QueueManager;

  constructor(config: AppConfig, queueManager: QueueManager) {
    this.maxDailyLossSol = config.trading.maxDailyLossSol;
    this.tradeRepository = new TradeRepository();
    this.queueManager = queueManager;
  }

  /**
   * Checks the current daily loss and trips the breaker if threshold exceeded.
   * @returns True if the breaker is tripped
   */
  async check(): Promise<boolean> {
    if (this.tripped) {
      return true;
    }

    try {
      const dailyLoss = await this.tradeRepository.getDailyLoss();

      if (dailyLoss >= this.maxDailyLossSol) {
        this.tripped = true;
        logger.error('CircuitBreaker TRIPPED: daily loss threshold exceeded', {
          dailyLoss,
          maxDailyLoss: this.maxDailyLossSol,
        });

        await this.queueManager.addJob(QueueName.ALERT, 'circuit-breaker', {
          level: 'error',
          message: `CIRCUIT BREAKER TRIPPED! Daily loss: ${dailyLoss.toFixed(4)} SOL (max: ${this.maxDailyLossSol} SOL)`,
          data: { dailyLoss, maxDailyLoss: this.maxDailyLossSol },
        } satisfies AlertJobPayload);

        return true;
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('CircuitBreaker: check failed', { error: errorMsg });
    }

    return this.tripped;
  }

  /**
   * Returns whether the circuit breaker is currently tripped.
   * @returns True if tripped
   */
  isTripped(): boolean {
    return this.tripped;
  }

  /**
   * Resets the circuit breaker (manual or via midnight cron).
   */
  reset(): void {
    this.tripped = false;
    logger.info('CircuitBreaker reset');
  }
}
