import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { logger } from '../utils/logger.js';
import { PUMP_FUN_PROGRAM } from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

/**
 * Listens for Pump.fun program log events.
 * Detects 'create' and 'buy' instructions on the bonding curve.
 */
export class PumpFunListener extends BaseListener {
  private subscriptionId: number | null = null;
  private connectionManager: ConnectionManager;

  constructor(queueManager: QueueManager) {
    super('PumpFunListener', queueManager);
    this.connectionManager = ConnectionManager.getInstance();
  }

  /**
   * Starts listening for Pump.fun events.
   */
  async start(): Promise<void> {
    this.isActive = true;
    const connection = this.connectionManager.getSubscriptionConnection();

    try {
      const pumpFunPubkey = new PublicKey(PUMP_FUN_PROGRAM);
      this.subscriptionId = connection.onLogs(
        pumpFunPubkey,
        (logs: Logs) => {
          if (!this.isActive) return;
          this.processPumpFunLogs(logs);
        },
        'confirmed',
      );
      logger.info('PumpFunListener subscribed', { programId: PUMP_FUN_PROGRAM });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PumpFunListener failed to start', { error: errorMsg });
    }
  }

  private processPumpFunLogs(logs: Logs): void {
    const logMessages = logs.logs;
    const signature = logs.signature;

    const hasCreate = logMessages.some((log) =>
      log.includes('Program log: Instruction: Create'),
    );
    const hasBuy = logMessages.some((log) =>
      log.includes('Program log: Instruction: Buy'),
    );

    if (hasCreate) {
      logger.info('Pump.fun token creation detected', { signature });

      this.onEvent({
        type: 'TOKEN_DETECTED',
        timestamp: Date.now(),
        data: {
          mintAddress: '',
          symbol: '',
          name: '',
          decimals: 6,
          supply: '0',
          createdAt: new Date(),
          source: 'pumpfun',
          initialLiquidity: 0,
          initialPrice: 0,
          isMutable: false,
          hasFreezable: false,
          metadataUri: '',
        },
      });
    }

    if (hasBuy) {
      logger.debug('Pump.fun buy detected', { signature });
    }
  }

  /**
   * Unsubscribes from Pump.fun events.
   */
  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      const connection = this.connectionManager.getSubscriptionConnection();
      try {
        await connection.removeOnLogsListener(this.subscriptionId);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('PumpFunListener failed to unsubscribe', { error: errorMsg });
      }
      this.subscriptionId = null;
    }
    await super.stop();
  }
}
