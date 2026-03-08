import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { logger } from '../utils/logger.js';
import { RAYDIUM_AMM_V4, WSOL_MINT } from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

/**
 * Listens for Raydium AMM v4 program log events.
 * Detects new pool initializations and liquidity add instructions.
 */
export class RaydiumPoolListener extends BaseListener {
  private subscriptionId: number | null = null;
  private connectionManager: ConnectionManager;

  constructor(queueManager: QueueManager) {
    super('RaydiumPoolListener', queueManager);
    this.connectionManager = ConnectionManager.getInstance();
  }

  /**
   * Starts listening for Raydium AMM events.
   */
  async start(): Promise<void> {
    this.isActive = true;
    const connection = this.connectionManager.getSubscriptionConnection();

    try {
      const raydiumPubkey = new PublicKey(RAYDIUM_AMM_V4);
      this.subscriptionId = connection.onLogs(
        raydiumPubkey,
        (logs: Logs) => {
          if (!this.isActive) return;
          this.processRaydiumLogs(logs);
        },
        'confirmed',
      );
      logger.info('RaydiumPoolListener subscribed', { programId: RAYDIUM_AMM_V4 });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('RaydiumPoolListener failed to start', { error: errorMsg });
    }
  }

  private processRaydiumLogs(logs: Logs): void {
    const logMessages = logs.logs;
    const signature = logs.signature;

    const hasInitialize = logMessages.some((log) =>
      log.includes('initialize2') || log.includes('Initialize2'),
    );
    const hasAddLiquidity = logMessages.some((log) =>
      log.includes('Deposit') || log.includes('deposit'),
    );

    if (hasInitialize) {
      logger.info('Raydium pool initialization detected', { signature });

      this.onEvent({
        type: 'POOL_CREATED',
        timestamp: Date.now(),
        data: {
          poolAddress: '',
          tokenMint: '',
          quoteMint: WSOL_MINT,
          dex: 'raydium',
          liquidity: 0,
          price: 0,
          volume24h: 0,
          createdAt: new Date(),
          isActive: true,
        },
      });
    }

    if (hasAddLiquidity) {
      logger.debug('Raydium liquidity add detected', { signature });
    }
  }

  /**
   * Unsubscribes from Raydium events.
   */
  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      const connection = this.connectionManager.getSubscriptionConnection();
      try {
        await connection.removeOnLogsListener(this.subscriptionId);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('RaydiumPoolListener failed to unsubscribe', { error: errorMsg });
      }
      this.subscriptionId = null;
    }
    await super.stop();
  }
}
