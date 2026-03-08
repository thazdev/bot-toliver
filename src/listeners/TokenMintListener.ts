import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';
import { isConnectionsPaused } from '../config/ConnectionsPausedResolver.js';
import { logger } from '../utils/logger.js';
import { TOKEN_PROGRAM_ID } from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

const LOG_THROTTLE_MS = 10_000;
const MINT_EXTRACT_FAIL_THROTTLE_MS = 30_000;

/**
 * Monitors the SPL Token program for InitializeMint instructions.
 * Extracts mint address, decimals, freeze authority, and mint authority.
 */
export class TokenMintListener extends BaseListener {
  private subscriptionId: number | null = null;
  private connectionManager: ConnectionManager;
  private lastMintLogAt = 0;
  private lastMintExtractFailAt = 0;

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
    if (isConnectionsPaused() || !(await isBotEnabled())) return;
    const logMessages = logs.logs;
    const signature = logs.signature;

    const hasInitializeMint = logMessages.some((log) =>
      log.includes('InitializeMint') || log.includes('Instruction: InitializeMint2'),
    );

    if (!hasInitializeMint) {
      return;
    }

    const now = Date.now();
    if (now - this.lastMintLogAt > LOG_THROTTLE_MS) {
      this.lastMintLogAt = now;
      logger.info('New token mint detected', { signature });
    }

    const mintAddress = await this.extractMintFromTransaction(signature);
    if (!mintAddress || mintAddress.length < 32) {
      if (now - this.lastMintExtractFailAt > MINT_EXTRACT_FAIL_THROTTLE_MS) {
        this.lastMintExtractFailAt = now;
        logger.debug('TokenMintListener: não foi possível extrair mint da tx', { signature: signature.slice(0, 16) });
      }
      return;
    }

    this.onEvent({
      type: 'TOKEN_DETECTED',
      timestamp: Date.now(),
      data: {
        mintAddress,
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
   * Extrai o mint da transação InitializeMint.
   * O mint é tipicamente o 1º ou 2º account na mensagem.
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

      // InitializeMint: mint é geralmente account 1 (0 = fee payer) ou 0
      const candidates = [accountKeys[1], accountKeys[0]].filter(Boolean);
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
   * Unsubscribes from token mint events.
   */
  async stop(): Promise<void> {
    this.isActive = false;
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
