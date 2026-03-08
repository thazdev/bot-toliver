import { type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { logger } from '../utils/logger.js';
import { LARGE_TX_THRESHOLD_SOL } from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';
import { QueueName } from '../types/queue.types.js';
import type { TokenScanJobPayload } from '../types/queue.types.js';

/**
 * Monitors logs for swap instructions above a configurable SOL threshold.
 * Pushes large transaction events for strategy evaluation.
 */
export class LargeTransactionListener extends BaseListener {
  private subscriptionId: number | null = null;
  private connectionManager: ConnectionManager;
  private thresholdSol: number;

  constructor(queueManager: QueueManager, thresholdSol: number = LARGE_TX_THRESHOLD_SOL) {
    super('LargeTransactionListener', queueManager);
    this.connectionManager = ConnectionManager.getInstance();
    this.thresholdSol = thresholdSol;
  }

  /**
   * Starts listening for large swap transactions.
   */
  async start(): Promise<void> {
    this.isActive = true;
    const connection = this.connectionManager.getSubscriptionConnection();

    try {
      this.subscriptionId = connection.onLogs(
        'all',
        (logs: Logs) => {
          if (!this.isActive) return;
          this.processLogs(logs);
        },
        'confirmed',
      );
      logger.info('LargeTransactionListener subscribed', {
        thresholdSol: this.thresholdSol,
      });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('LargeTransactionListener failed to start', { error: errorMsg });
    }
  }

  private processLogs(logs: Logs): void {
    const logMessages = logs.logs;
    const signature = logs.signature;

    const hasSwap = logMessages.some((log) =>
      log.includes('Swap') || log.includes('swap'),
    );

    if (!hasSwap) {
      return;
    }

    const amountMatch = logMessages.find((log) => {
      const match = log.match(/Transfer (\d+)/);
      if (match) {
        const lamports = parseInt(match[1], 10);
        const sol = lamports / 1_000_000_000;
        return sol >= this.thresholdSol;
      }
      return false;
    });

    if (amountMatch) {
      logger.info('Large transaction detected', { signature, thresholdSol: this.thresholdSol });

      this.queueManager.addJob(QueueName.TOKEN_SCAN, 'large-tx-detected', {
        tokenInfo: { mintAddress: '' },
        source: 'large-tx',
        detectedAt: Date.now(),
        txSignature: signature,
      } satisfies TokenScanJobPayload);
    }
  }

  /**
   * Unsubscribes from log events.
   */
  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      const connection = this.connectionManager.getSubscriptionConnection();
      try {
        await connection.removeOnLogsListener(this.subscriptionId);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('LargeTransactionListener failed to unsubscribe', { error: errorMsg });
      }
      this.subscriptionId = null;
    }
    await super.stop();
  }
}
