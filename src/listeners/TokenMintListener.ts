import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';
import { logger } from '../utils/logger.js';
import { TOKEN_PROGRAM_ID } from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

/**
 * Monitors the SPL Token program for InitializeMint instructions.
 * Extracts mint address, decimals, freeze authority, and mint authority.
 */
export class TokenMintListener extends BaseListener {
  private subscriptionId: number | null = null;
  private connectionManager: ConnectionManager;

  constructor(queueManager: QueueManager) {
    super('TokenMintListener', queueManager);
    this.connectionManager = ConnectionManager.getInstance();
  }

  /**
   * Starts listening for token mint initialization events.
   */
  async start(): Promise<void> {
    this.isActive = true;
    const connection = this.connectionManager.getSubscriptionConnection();

    try {
      const tokenProgramId = new PublicKey(TOKEN_PROGRAM_ID);
      this.subscriptionId = connection.onLogs(
        tokenProgramId,
        (logs: Logs) => {
          if (!this.isActive) return;
          void this.processTokenLogs(logs);
        },
        'confirmed',
      );
      logger.info('TokenMintListener subscribed to Token program');
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TokenMintListener failed to start', { error: errorMsg });
    }
  }

  private async processTokenLogs(logs: Logs): Promise<void> {
    if (!(await isBotEnabled())) return;
    const logMessages = logs.logs;
    const signature = logs.signature;

    const hasInitializeMint = logMessages.some((log) =>
      log.includes('InitializeMint') || log.includes('Instruction: InitializeMint2'),
    );

    if (!hasInitializeMint) {
      return;
    }

    logger.info('New token mint detected', { signature });

    this.onEvent({
      type: 'TOKEN_DETECTED',
      timestamp: Date.now(),
      data: {
        mintAddress: '',
        symbol: '',
        name: '',
        decimals: 0,
        supply: '0',
        createdAt: new Date(),
        source: 'unknown',
        initialLiquidity: 0,
        initialPrice: 0,
        isMutable: false,
        hasFreezable: false,
        metadataUri: '',
      },
    });
  }

  /**
   * Unsubscribes from token mint events.
   */
  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      const connection = this.connectionManager.getSubscriptionConnection();
      try {
        await connection.removeOnLogsListener(this.subscriptionId);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('TokenMintListener failed to unsubscribe', { error: errorMsg });
      }
      this.subscriptionId = null;
    }
    await super.stop();
  }
}
