import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { logger } from '../utils/logger.js';
import { RAYDIUM_AMM_V4, PUMP_FUN_PROGRAM, TOKEN_PROGRAM_ID } from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

/**
 * Subscribes to on-chain logs via connection.onLogs() for key programs.
 * Detects new pool creation, token mints, and swap events from log data.
 */
export class LogsListener extends BaseListener {
  private subscriptionIds: number[] = [];
  private connectionManager: ConnectionManager;

  constructor(queueManager: QueueManager) {
    super('LogsListener', queueManager);
    this.connectionManager = ConnectionManager.getInstance();
  }

  /**
   * Starts log subscriptions for Raydium, PumpFun, and Token programs.
   */
  async start(): Promise<void> {
    this.isActive = true;
    const connection = this.connectionManager.getConnection();

    const programs = [
      { name: 'Raydium AMM V4', id: RAYDIUM_AMM_V4 },
      { name: 'Pump.fun', id: PUMP_FUN_PROGRAM },
      { name: 'Token Program', id: TOKEN_PROGRAM_ID },
    ];

    for (const program of programs) {
      try {
        const pubkey = new PublicKey(program.id);
        const subId = connection.onLogs(
          pubkey,
          (logs: Logs) => {
            if (!this.isActive) return;
            this.processLogs(program.name, logs);
          },
          'confirmed',
        );
        this.subscriptionIds.push(subId);
        logger.info(`LogsListener subscribed to ${program.name}`, { programId: program.id });
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`LogsListener failed to subscribe to ${program.name}`, {
          programId: program.id,
          error: errorMsg,
        });
      }
    }
  }

  private processLogs(programName: string, logs: Logs): void {
    const logMessages = logs.logs;
    const signature = logs.signature;

    const hasInitialize = logMessages.some((log) =>
      log.includes('Initialize') || log.includes('initialize'),
    );
    const hasCreate = logMessages.some((log) =>
      log.includes('Create') || log.includes('create'),
    );
    const hasSwap = logMessages.some((log) =>
      log.includes('Swap') || log.includes('swap'),
    );
    const hasMint = logMessages.some((log) =>
      log.includes('InitializeMint') || log.includes('MintTo'),
    );

    if (hasInitialize || hasCreate) {
      this.onEvent({
        type: 'POOL_CREATED',
        timestamp: Date.now(),
        data: {
          poolAddress: '',
          tokenMint: '',
          quoteMint: '',
          dex: programName.includes('Raydium') ? 'raydium' : 'pumpfun',
          liquidity: 0,
          price: 0,
          volume24h: 0,
          createdAt: new Date(),
          isActive: true,
        },
      });

      logger.info('Pool creation detected', { program: programName, signature });
    }

    if (hasMint) {
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

    if (hasSwap) {
      logger.debug('Swap detected', { program: programName, signature });
    }
  }

  /**
   * Unsubscribes from all log subscriptions.
   */
  async stop(): Promise<void> {
    const connection = this.connectionManager.getConnection();
    for (const subId of this.subscriptionIds) {
      try {
        await connection.removeOnLogsListener(subId);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('LogsListener failed to unsubscribe', { subId, error: errorMsg });
      }
    }
    this.subscriptionIds = [];
    await super.stop();
  }
}
