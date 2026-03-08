import { PublicKey } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';
import { logger } from '../utils/logger.js';
import { RAYDIUM_AMM_V4, PUMP_FUN_PROGRAM } from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

/**
 * Listens for program account changes on Raydium and PumpFun programs
 * using connection.onProgramAccountChange().
 */
export class ProgramAccountListener extends BaseListener {
  private subscriptionIds: number[] = [];
  private connectionManager: ConnectionManager;

  constructor(queueManager: QueueManager) {
    super('ProgramAccountListener', queueManager);
    this.connectionManager = ConnectionManager.getInstance();
  }

  /**
   * Starts account change subscriptions for Raydium and PumpFun.
   */
  async start(): Promise<void> {
    this.isActive = true;
    const connection = this.connectionManager.getSubscriptionConnection();

    const programs = [
      { name: 'Raydium AMM V4', id: RAYDIUM_AMM_V4 },
      { name: 'Pump.fun', id: PUMP_FUN_PROGRAM },
    ];

    for (const program of programs) {
      try {
        const pubkey = new PublicKey(program.id);
        const subId = connection.onProgramAccountChange(
          pubkey,
          (accountInfo) => {
            if (!this.isActive) return;
            void this.processAccountChange(program.name, accountInfo);
          },
          'confirmed',
        );
        this.subscriptionIds.push(subId);
        logger.info(`ProgramAccountListener subscribed to ${program.name}`, {
          programId: program.id,
        });
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`ProgramAccountListener failed to subscribe to ${program.name}`, {
          error: errorMsg,
        });
      }
    }
  }

  private async processAccountChange(programName: string, accountInfo: { accountId: PublicKey; accountInfo: { data: Buffer } }): Promise<void> {
    if (!(await isBotEnabled())) return;
    const accountAddress = accountInfo.accountId.toBase58();
    const dataLength = accountInfo.accountInfo.data.length;

    logger.debug('Program account change detected', {
      program: programName,
      account: accountAddress,
      dataLength,
    });
    // Não emite POOL_CREATED sem tokenMint — evita flood de "ignorado"
  }

  /**
   * Unsubscribes from all program account subscriptions.
   */
  async stop(): Promise<void> {
    const connection = this.connectionManager.getSubscriptionConnection();
    for (const subId of this.subscriptionIds) {
      try {
        await connection.removeProgramAccountChangeListener(subId);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('ProgramAccountListener failed to unsubscribe', { subId, error: errorMsg });
      }
    }
    this.subscriptionIds = [];
    await super.stop();
  }
}
