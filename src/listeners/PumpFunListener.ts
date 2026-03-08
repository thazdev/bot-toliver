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
const MINT_EXTRACT_FAIL_THROTTLE_MS = 30_000;

export class PumpFunListener extends BaseListener {
  private subscriptionId: number | null = null;
  private connectionManager: ConnectionManager;
  private lastCreateLogAt = 0;
  private lastMintExtractFailAt = 0;

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
          logger.debug('RAW_LOG_RECEIVED', {
            program: PUMP_FUN_PROGRAM,
            signature: logs.signature,
            logsCount: logs.logs?.length ?? 0,
            firstLog: logs.logs?.[0]?.substring(0, 100),
          });
          if (!this.isActive) return;
          this.processPumpFunLogs(logs);
        },
        'confirmed',
      );
      logger.debug('PumpFunListener subscribed', { programId: PUMP_FUN_PROGRAM });
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
        logger.debug('Pump.fun token creation detected', { signature });
      }

      // 1) Program data (base64) — sem RPC, mais rápido
      let mintAddress = this.extractMintFromProgramData(logMessages);
      // 2) Regex em logs (mint: xxx)
      if (!mintAddress) mintAddress = this.extractMintFromLogs(logMessages);
      // 3) Fallback: getTransaction (RPC)
      if (!mintAddress) mintAddress = await this.extractMintFromTransaction(signature);
      if (!mintAddress || mintAddress.length < 32) {
        if (now - this.lastMintExtractFailAt > MINT_EXTRACT_FAIL_THROTTLE_MS) {
          this.lastMintExtractFailAt = now;
          logger.warn('PumpFunListener: não foi possível extrair mint (tentei Program data, logs e getTransaction)', {
            signature: signature.slice(0, 16),
            hasProgramData: logMessages.some((l) => l.startsWith('Program data:')),
          });
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
      // Buy detectado — sem log para reduzir ruído (eventos muito frequentes)
    }
  }

  /** Discriminator da instrução Create: sha256("global:create")[0:8] */
  private static readonly CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

  /**
   * Extrai mint do "Program data:" base64 (Create instruction).
   * Só processa dados com discriminator Create para evitar Metaplex/Buy.
   * Formato: 8b discriminator + name + symbol + uri + 32b mint + 32b bondingCurve + 32b user.
   */
  private extractMintFromProgramData(logMessages: string[]): string {
    for (const log of logMessages) {
      if (!log.startsWith('Program data:')) continue;
      const base64 = log.replace(/^Program data:\s*/, '').trim();
      if (!base64) continue;
      try {
        const buf = Buffer.from(base64, 'base64');
        if (buf.length < 8 + 4 + 4 + 4 + 32 + 32 + 32) continue;
        if (buf.subarray(0, 8).compare(PumpFunListener.CREATE_DISCRIMINATOR) !== 0) continue;
        let offset = 8;
        const readString = (): void => {
          if (offset + 4 > buf.length) return;
          const len = buf.readUInt32LE(offset);
          offset += 4 + len;
        };
        readString();
        readString();
        readString();
        if (offset + 32 > buf.length) continue;
        const mintBytes = buf.subarray(offset, offset + 32);
        const mint = new PublicKey(mintBytes).toBase58();
        if (mint.length >= 32 && mint.length <= 44) return mint;
      } catch {
        // ignora erro de parse
      }
    }
    return '';
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
   * Suporta transações versionadas (v0) com loadedAddresses.
   * Mint = 7º account (índice 6) na instrução Create.
   */
  private async extractMintFromTransaction(signature: string): Promise<string> {
    try {
      const connection = this.connectionManager.getConnection();
      const rateLimiter = this.connectionManager.getRateLimiter();
      const tx = await rateLimiter.schedule(() =>
        connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 }),
      );
      if (!tx?.transaction?.message) return '';

      const msg = tx.transaction.message;
      const keys = msg.getAccountKeys?.();
      let accountKeys: unknown[] = [];

      if (keys) {
        if (Array.isArray(keys)) {
          accountKeys = keys;
        } else if (keys.staticAccountKeys) {
          accountKeys = [...keys.staticAccountKeys];
          const meta = tx.meta as { loadedAddresses?: { writable?: string[]; readonly?: string[] } } | undefined;
          const loaded = meta?.loadedAddresses;
          if (loaded?.writable?.length) accountKeys.push(...loaded.writable);
          if (loaded?.readonly?.length) accountKeys.push(...loaded.readonly);
        } else {
          accountKeys = (keys as { staticAccountKeys?: unknown[] }).staticAccountKeys ?? [];
        }
      }

      const toBase58 = (k: unknown): string =>
        typeof k === 'string' ? k : (k as { toBase58?: () => string })?.toBase58?.() ?? '';

      const candidates = [
        accountKeys[6],
        accountKeys[7],
        accountKeys[8],
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
