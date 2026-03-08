// UPDATED: ExitDecisionEngine centralizado - 2026-03-07
import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import { TradeExecutor } from '../execution/TradeExecutor.js';
import { QueueManager } from '../core/queue/QueueManager.js';
import { QueueName } from '../types/queue.types.js';
import type { AlertJobPayload } from '../types/queue.types.js';
import { getEffectiveDryRun } from '../config/DryRunResolver.js';
import { loadConfig } from '../config/index.js';

export type ExitSource =
  | 'StopLoss'
  | 'TrailingStop'
  | 'WhaleMonitor'
  | 'ProfitTaker'
  | 'ExitManager'
  | 'RugDetector'
  | 'TimeBasedExit';

export type ExitUrgency = 'EMERGENCY' | 'HIGH' | 'NORMAL';

export interface ExitSignal {
  source: ExitSource;
  tokenMint: string;
  positionId: string;
  urgency: ExitUrgency;
  sellPercentage: number;
  reason: string;
}

interface PendingSignal {
  signal: ExitSignal;
  receivedAt: number;
}

const EXIT_LOCK_TTL_SEC = parseInt(process.env.EXIT_LOCK_TTL_SEC ?? '10', 10);
const NORMAL_BATCH_WINDOW_MS = parseInt(process.env.EXIT_BATCH_WINDOW_MS ?? '500', 10);

export class ExitDecisionEngine {
  private tradeExecutor: TradeExecutor;
  private queueManager: QueueManager;
  private pendingNormalSignals: Map<string, PendingSignal[]> = new Map();
  private emergencyQueue: Map<string, ExitSignal> = new Map();
  private batchTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(tradeExecutor: TradeExecutor, queueManager: QueueManager) {
    this.tradeExecutor = tradeExecutor;
    this.queueManager = queueManager;
  }

  async requestExit(signal: ExitSignal): Promise<void> {
    try {
      logger.debug('ExitDecisionEngine: exit request received', {
        source: signal.source,
        positionId: signal.positionId,
        tokenMint: signal.tokenMint.slice(0, 8),
        urgency: signal.urgency,
        sellPercentage: signal.sellPercentage,
        reason: signal.reason,
      });

      if (signal.urgency === 'EMERGENCY') {
        const lockKey = `exit_lock:${signal.positionId}`;
        await this.forceAcquireLock(lockKey, EXIT_LOCK_TTL_SEC);
        try {
          await this.handleEmergency(signal);
        } finally {
          await this.releaseLock(lockKey);
        }
        return;
      }

      if (signal.urgency === 'NORMAL') {
        this.enqueueNormal(signal);
        return;
      }

      const lockKey = `exit_lock:${signal.positionId}`;
      const lockAcquired = await this.acquireLock(lockKey, EXIT_LOCK_TTL_SEC);

      if (!lockAcquired) {
        logger.debug('ExitDecisionEngine: exit already in progress', {
          positionId: signal.positionId,
          ignoredSource: signal.source,
        });
        return;
      }

      try {
        await this.handleHigh(signal);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('ExitDecisionEngine: error processing HIGH exit signal', {
          positionId: signal.positionId,
          source: signal.source,
          error: errorMsg,
        });
      } finally {
        await this.releaseLock(lockKey);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ExitDecisionEngine: fatal error in requestExit', {
        positionId: signal.positionId,
        error: errorMsg,
      });
    }
  }

  private async handleEmergency(signal: ExitSignal): Promise<void> {
    this.emergencyQueue.set(signal.tokenMint, signal);

    logger.warn('ExitDecisionEngine: EMERGENCY exit executing immediately', {
      source: signal.source,
      positionId: signal.positionId,
      tokenMint: signal.tokenMint.slice(0, 8),
      reason: signal.reason,
    });

    await this.executeSell(signal);
    this.emergencyQueue.delete(signal.tokenMint);
    this.clearPendingForPosition(signal.positionId);
  }

  private async handleHigh(signal: ExitSignal): Promise<void> {
    const hasEmergency = this.emergencyQueue.has(signal.tokenMint);

    if (hasEmergency) {
      logger.debug('ExitDecisionEngine: HIGH signal deferred — EMERGENCY active for same token', {
        source: signal.source,
        positionId: signal.positionId,
        tokenMint: signal.tokenMint.slice(0, 8),
      });
      return;
    }

    logger.debug('ExitDecisionEngine: HIGH urgency exit executing', {
      source: signal.source,
      positionId: signal.positionId,
      reason: signal.reason,
    });

    await this.executeSell(signal);
  }

  private enqueueNormal(signal: ExitSignal): void {
    const key = signal.positionId;
    const pending = this.pendingNormalSignals.get(key) ?? [];
    pending.push({ signal, receivedAt: Date.now() });
    this.pendingNormalSignals.set(key, pending);

    if (!this.batchTimers.has(key)) {
      const timer = setTimeout(async () => {
        this.batchTimers.delete(key);
        await this.processNormalBatch(key);
      }, NORMAL_BATCH_WINDOW_MS);
      this.batchTimers.set(key, timer);
    }
  }

  private async processNormalBatch(positionId: string): Promise<void> {
    const pending = this.pendingNormalSignals.get(positionId);
    if (!pending || pending.length === 0) return;

    this.pendingNormalSignals.delete(positionId);

    const lockKey = `exit_lock:${positionId}`;
    const lockAcquired = await this.acquireLock(lockKey, EXIT_LOCK_TTL_SEC);

    if (!lockAcquired) {
      logger.debug('ExitDecisionEngine: batch processing skipped — lock held', {
        positionId,
        pendingCount: pending.length,
      });
      return;
    }

    try {
      const best = pending.reduce((a, b) =>
        b.signal.sellPercentage > a.signal.sellPercentage ? b : a,
      );

      const ignoredSources = pending
        .filter(p => p !== best)
        .map(p => p.signal.source);

      logger.debug('ExitDecisionEngine: NORMAL batch resolved', {
        positionId,
        winnerSource: best.signal.source,
        winnerSellPct: best.signal.sellPercentage,
        ignoredSources,
        batchSize: pending.length,
        reason: best.signal.reason,
      });

      await this.executeSell(best.signal);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ExitDecisionEngine: batch processing error', {
        positionId,
        error: errorMsg,
      });
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  private async executeSell(signal: ExitSignal): Promise<void> {
    try {
      const config = loadConfig();
      const dryRun = await getEffectiveDryRun(config);
      const result = await this.tradeExecutor.execute(
        {
          tokenMint: signal.tokenMint,
          direction: 'sell',
          amountSol: 0,
          slippageBps: 300,
          strategyId: `exit:${signal.source}`,
          dryRun,
        },
        {
          positionId: signal.positionId,
          isEmergency: signal.urgency === 'EMERGENCY',
        },
      );

      logger.debug('ExitDecisionEngine: sell executed', {
        source: signal.source,
        positionId: signal.positionId,
        tokenMint: signal.tokenMint.slice(0, 8),
        urgency: signal.urgency,
        sellPercentage: signal.sellPercentage,
        txSignature: result.txSignature,
        status: result.status,
      });

      await this.queueManager.addJob(QueueName.ALERT, 'exit-executed', {
        level: 'trade',
        message: `EXIT [${signal.urgency}] via ${signal.source}: ${signal.reason}`,
        data: {
          positionId: signal.positionId,
          tokenMint: signal.tokenMint,
          sellPercentage: signal.sellPercentage,
          txSignature: result.txSignature,
        },
      } satisfies AlertJobPayload);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ExitDecisionEngine: sell execution failed', {
        positionId: signal.positionId,
        source: signal.source,
        error: errorMsg,
      });
    }
  }

  private async forceAcquireLock(key: string, ttlSec: number): Promise<void> {
    try {
      const redis = RedisClient.getInstance().getClient();
      await redis.set(key, 'emergency', 'EX', ttlSec);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ExitDecisionEngine: Redis force lock failed — proceeding anyway', {
        key,
        error: errorMsg,
      });
    }
  }

  private async acquireLock(key: string, ttlSec: number): Promise<boolean> {
    try {
      const redis = RedisClient.getInstance().getClient();
      const result = await redis.set(key, '1', 'EX', ttlSec, 'NX');
      return result === 'OK';
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ExitDecisionEngine: Redis lock acquisition failed — proceeding anyway', {
        key,
        error: errorMsg,
      });
      return true;
    }
  }

  private async releaseLock(key: string): Promise<void> {
    try {
      const redis = RedisClient.getInstance().getClient();
      await redis.del(key);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ExitDecisionEngine: Redis lock release failed', {
        key,
        error: errorMsg,
      });
    }
  }

  private clearPendingForPosition(positionId: string): void {
    const timer = this.batchTimers.get(positionId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(positionId);
    }
    this.pendingNormalSignals.delete(positionId);
  }

  shutdown(): void {
    for (const [key, timer] of this.batchTimers) {
      clearTimeout(timer);
      this.batchTimers.delete(key);
    }
    this.pendingNormalSignals.clear();
    this.emergencyQueue.clear();
  }
}
