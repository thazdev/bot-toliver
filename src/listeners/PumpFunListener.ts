import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';
import { isConnectionsPaused } from '../config/ConnectionsPausedResolver.js';
import { logger } from '../utils/logger.js';
import { PUMP_FUN_PROGRAM } from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

/**
 * Listens for Pump.fun program log events.
 * Detects 'create' and 'buy' instructions on the bonding curve.
 */
const LOG_THROTTLE_MS = 10_000;

export class PumpFunListener extends BaseListener {
  private subscriptionId: number | null = null;
  private connectionManager: ConnectionManager;
  private lastCreateLogAt = 0;

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

  private async processPumpFunLogs(logs: Logs): Promise<void> {
    if (isConnectionsPaused() || !(await isBotEnabled())) return;
    const logMessages = logs.logs;
    const signature = logs.signature;

    const hasCreate = logMessages.some((log) =>
      log.includes('Program log: Instruction: Create'),
    );
    const hasBuy = logMessages.some((log) =>
      log.includes('Program log: Instruction: Buy'),
    );

    if (hasCreate) {
      const now = Date.now();
      if (now - this.lastCreateLogAt > LOG_THROTTLE_MS) {
        this.lastCreateLogAt = now;
        logger.info('Pump.fun token creation detected', { signature });
      } else {
        logger.debug('Pump.fun token creation detected', { signature });
      }

      let mintAddress = this.extractMintFromLogs(logMessages);
      if (!mintAddress) {
        mintAddress = await this.extractMintFromTransaction(signature);
      }
      if (!mintAddress || mintAddress.length < 32) {
        logger.debug('PumpFunListener: não foi possível extrair mint da tx', { signature: signature.slice(0, 16) });
        return;
      }

      this.onEvent({
        type: 'TOKEN_DETECTED',
        timestamp: Date.now(),
        data: {
          mintAddress,
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
   * Tenta extrair o mint dos logs (ex.: "mint: xxx" ou base58 em logs).
   */
  private extractMintFromLogs(logMessages: string[]): string {
    for (const log of logMessages) {
      const mintMatch = log.match(/mint[=:\s]+([A-Za-z0-9]{32,44})/i);
      if (mintMatch) return mintMatch[1];
    }
    return '';
  }

  /**
   * Extrai o mint da transação Pump.fun Create.
   * O mint é o 7º account (índice 6) na instrução Create; fallback para último account.
   */
  private async extractMintFromTransaction(signature: string): Promise<string> {
    try {
      const connection = this.connectionManager.getConnection();
      const rateLimiter = this.connectionManager.getRateLimiter();
      const tx = await rateLimiter.schedule(() =>
        connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 }),
      );
      if (!tx?.transaction?.message) return '';

      const keys = tx.transaction.message.getAccountKeys?.();
      const accountKeys = keys?.staticAccountKeys ?? keys ?? [];

      const toBase58 = (k: unknown): string =>
        typeof k === 'string' ? k : (k as { toBase58?: () => string })?.toBase58?.() ?? '';

      const candidates = [
        accountKeys[6],
        accountKeys[7],
        accountKeys[accountKeys.length - 1],
      ].filter(Boolean);

      for (const k of candidates) {
        const mint = toBase58(k);
        if (mint.length >= 32 && mint.length <= 44) return mint;
      }
      return '';
    } catch {
      return '';
    }
  }

  /**
   * Unsubscribes from Pump.fun events.
   */
  async stop(): Promise<void> {
    this.isActive = false;
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
