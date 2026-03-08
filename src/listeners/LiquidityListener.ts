import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';
import { logger } from '../utils/logger.js';
import { RAYDIUM_AMM_V4, PUMP_FUN_PROGRAM, WSOL_MINT } from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

/**
 * Monitors AddLiquidity events on both Raydium and Pump.fun.
 * Emits POOL_CREATED events with pool details to the queue.
 */
export class LiquidityListener extends BaseListener {
  private subscriptionIds: number[] = [];
  private connectionManager: ConnectionManager;

  constructor(queueManager: QueueManager) {
    super('LiquidityListener', queueManager);
    this.connectionManager = ConnectionManager.getInstance();
  }

  /**
   * Starts listening for liquidity events on Raydium and PumpFun.
   */
  async start(): Promise<void> {
    this.isActive = true;
    const connection = this.connectionManager.getSubscriptionConnection();

    const programs = [
      { name: 'Raydium', id: RAYDIUM_AMM_V4 },
      { name: 'PumpFun', id: PUMP_FUN_PROGRAM },
    ];

    for (const program of programs) {
      try {
        const pubkey = new PublicKey(program.id);
        const subId = connection.onLogs(
          pubkey,
          (logs: Logs) => {
            if (!this.isActive) return;
            void this.processLiquidityLogs(program.name, logs);
          },
          'confirmed',
        );
        this.subscriptionIds.push(subId);
        logger.info(`LiquidityListener subscribed to ${program.name}`, { programId: program.id });
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`LiquidityListener failed to subscribe to ${program.name}`, { error: errorMsg });
      }
    }
  }

  private async processLiquidityLogs(programName: string, logs: Logs): Promise<void> {
    if (!(await isBotEnabled())) return;
    const logMessages = logs.logs;
    const signature = logs.signature;

    const hasLiquidityAdd = logMessages.some((log) =>
      log.includes('Deposit') ||
      log.includes('AddLiquidity') ||
      log.includes('addLiquidity'),
    );

    if (!hasLiquidityAdd) {
      return;
    }

    logger.info('Liquidity add detected', { program: programName, signature });

    this.onEvent({
      type: 'POOL_CREATED',
      timestamp: Date.now(),
      data: {
        poolAddress: '',
        tokenMint: '',
        quoteMint: WSOL_MINT,
        dex: programName === 'Raydium' ? 'raydium' : 'pumpfun',
        liquidity: 0,
        price: 0,
        volume24h: 0,
        createdAt: new Date(),
        isActive: true,
      },
    });
  }

  /**
   * Unsubscribes from all liquidity event subscriptions.
   */
  async stop(): Promise<void> {
    const connection = this.connectionManager.getSubscriptionConnection();
    for (const subId of this.subscriptionIds) {
      try {
        await connection.removeOnLogsListener(subId);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('LiquidityListener failed to unsubscribe', { subId, error: errorMsg });
      }
    }
    this.subscriptionIds = [];
    await super.stop();
  }
}
