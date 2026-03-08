import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';
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
          logger.debug('RAW_LOG_RECEIVED', {
            program: RAYDIUM_AMM_V4,
            signature: logs.signature,
            logsCount: logs.logs?.length ?? 0,
            firstLog: logs.logs?.[0]?.substring(0, 100),
          });
          if (!this.isActive) return;
          void this.processRaydiumLogs(logs);
        },
        'confirmed',
      );
      logger.debug('RaydiumPoolListener subscribed', { programId: RAYDIUM_AMM_V4 });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('RaydiumPoolListener failed to start', { error: errorMsg });
    }
  }

  private async processRaydiumLogs(logs: Logs): Promise<void> {
    if (!(await isBotEnabled())) return;
    const logMessages = logs.logs;
    const signature = logs.signature;

    const hasInitialize = logMessages.some((log) =>
      log.includes('initialize2') || log.includes('Initialize2'),
    );
    const hasAddLiquidity = logMessages.some((log) =>
      log.includes('Deposit') || log.includes('deposit'),
    );

    if (hasInitialize) {
      logger.debug('Raydium pool initialization detected', { signature });
      // Não emite sem tokenMint — LogsListener cobre com dados extraídos da tx
    }

    if (hasAddLiquidity) {
      // Liquidity add detectado — sem log para reduzir ruído (eventos muito frequentes)
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
