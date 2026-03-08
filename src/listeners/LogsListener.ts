import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import { BotHealthMonitor } from '../monitoring/BotHealthMonitor.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';
import { isConnectionsPaused } from '../config/ConnectionsPausedResolver.js';
import { logger } from '../utils/logger.js';
import {
  RAYDIUM_AMM_V4,
  PUMP_FUN_PROGRAM,
} from '../utils/constants.js';
import { QueueName } from '../types/queue.types.js';
import type { QueueManager } from '../core/queue/QueueManager.js';
import type { TokenScanJobPayload } from '../types/queue.types.js';

const RAYDIUM_CLMM = process.env.RAYDIUM_CLMM_PROGRAM ?? 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';

interface DetectedToken {
  mintAddress: string | null;
  poolAddress?: string;
  source: 'pumpfun' | 'raydium' | 'raydium_clmm';
  signature: string;
  needsResolution?: boolean;
  initialLiquiditySOL?: number;
}

const LOG_THROTTLE_MS = 30_000;
const DISCOVERY_LOG_INTERVAL_MS = 15_000;

export class LogsListener extends BaseListener {
  private subscriptionIds: number[] = [];
  private connectionManager: ConnectionManager;
  private logBatchCount = 0;
  private lastLogInfoAt = 0;
  private lastDiscoveryLogAt = 0;
  private lastFetchTxErrorAt = 0;
  private lastLatencyWarnAt = 0;
  private lastNoTokenMintAt = 0;
  private lastLiquidityBelowAt = 0;
  private eventCounter = 0;
  private tokenCounter = 0;
  private poolCounter = 0;
  private discoveryHeartbeatInterval: ReturnType<typeof setInterval> | null = null;

  /** Discriminator da instrução Create: sha256("global:create")[0:8] */
  private static readonly CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

  constructor(queueManager: QueueManager) {
    super('LogsListener', queueManager);
    this.connectionManager = ConnectionManager.getInstance();
  }

  async start(): Promise<void> {
    this.isActive = true;
    const connection = this.connectionManager.getSubscriptionConnection();

    const programs = [
      { name: 'Raydium AMM V4', id: RAYDIUM_AMM_V4 },
      { name: 'Pump.fun', id: PUMP_FUN_PROGRAM },
      { name: 'Raydium CLMM', id: RAYDIUM_CLMM },
    ];

    for (const program of programs) {
      try {
        const pubkey = new PublicKey(program.id);
        const commitment = (process.env.LOGS_LISTENER_COMMITMENT as 'processed' | 'confirmed' | 'finalized') ?? 'processed';
        const subId = connection.onLogs(
          pubkey,
          (logs: Logs) => {
            logger.debug('RAW_LOG_RECEIVED', {
              program: program.id,
              signature: logs.signature,
              logsCount: logs.logs?.length ?? 0,
              firstLog: logs.logs?.[0]?.substring(0, 100),
            });
            if (!this.isActive) return;
            void this.processLogs(program.name, program.id, logs);
          },
          commitment,
        );
        this.subscriptionIds.push(subId);
        logger.debug(`LogsListener subscribed to ${program.name}`, { programId: program.id });
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`LogsListener failed to subscribe to ${program.name}`, {
          programId: program.id,
          error: errorMsg,
        });
      }
    }

    this.discoveryHeartbeatInterval = setInterval(() => {
      logger.debug('DISCOVERY_HEARTBEAT', {
        eventsLast60s: this.eventCounter,
        tokensDetectedLast60s: this.tokenCounter,
        poolsDetectedLast60s: this.poolCounter,
      });
      this.eventCounter = 0;
      this.tokenCounter = 0;
      this.poolCounter = 0;
    }, 60_000);
  }

  private async processLogs(programName: string, programId: string, logs: Logs): Promise<void> {
    if (!this.isActive || isConnectionsPaused() || !(await isBotEnabled())) return;
    BotHealthMonitor.recordEvent();
    this.logBatchCount++;
    this.eventCounter++;

    const logMessages = logs.logs ?? [];
    const signature = logs.signature;

    const detected = this.parseLogsForToken(logMessages, signature, programId);
    if (!detected) {
      try {
        const redis = RedisClient.getInstance().getClient();
        await redis.incr('diag:logs_no_token_detected');
      } catch {
        // ignora
      }
      logger.debug('LOG_NO_TOKEN', { signature, program: programId });
      return;
    }

    const now = Date.now();
    if (now - this.lastLogInfoAt > 60_000) {
      this.lastLogInfoAt = now;
      logger.debug('LogsListener: WebSocket recebendo logs', {
        batchesReceived: this.logBatchCount,
        program: programName,
      });
    }

    if (detected.needsResolution) {
      await this.enqueueForResolution(detected);
      return;
    }

    if (detected.mintAddress && detected.mintAddress.length >= 32) {
      await this.emitPoolCreated(detected);
    }
  }

  private parseLogsForToken(logs: string[], signature: string, program: string): DetectedToken | null {
    if (program === PUMP_FUN_PROGRAM) {
      const hasCreate = logs.some(
        (l) => l.includes('Program log: Create') || l.includes('Instruction: Create'),
      );
      const hasInitAccount = logs.some(
        (l) =>
          l.includes('InitializeAccount3') ||
          l.includes('Initialize the associated token account'),
      );

      if (hasCreate && hasInitAccount) {
        const mint = this.extractMintFromPumpFunLogs(logs);
        if (mint) {
          const poolAddress = this.extractPoolFromPumpFunLogs(logs);
          return {
            mintAddress: mint,
            poolAddress,
            source: 'pumpfun',
            signature,
            initialLiquiditySOL: 30,
          };
        }
        return {
          mintAddress: null,
          source: 'pumpfun',
          signature,
          needsResolution: true,
        };
      }
    }

    if (program === RAYDIUM_AMM_V4) {
      const hasInitialize = logs.some(
        (l) =>
          l.includes('initialize2') ||
          l.includes('Instruction: Initialize2') ||
          l.includes('ray_log'),
      );
      if (hasInitialize) {
        const extracted = this.extractTokenFromRaydiumLogs(logs);
        if (extracted.tokenMint) {
          return {
            mintAddress: extracted.tokenMint,
            poolAddress: extracted.poolAddress,
            source: 'raydium',
            signature,
            initialLiquiditySOL: extracted.initialLiquiditySOL,
          };
        }
        return { mintAddress: null, source: 'raydium', signature, needsResolution: true };
      }
    }

    if (program === RAYDIUM_CLMM) {
      const hasPoolCreation = logs.some(
        (l) =>
          l.includes('CreatePool') ||
          l.includes('OpenPosition') ||
          l.includes('Instruction: CreatePool'),
      );
      if (hasPoolCreation) {
        const extracted = this.extractTokenFromRaydiumLogs(logs);
        if (extracted.tokenMint) {
          return {
            mintAddress: extracted.tokenMint,
            poolAddress: extracted.poolAddress,
            source: 'raydium_clmm',
            signature,
            initialLiquiditySOL: extracted.initialLiquiditySOL,
          };
        }
        return { mintAddress: null, source: 'raydium_clmm', signature, needsResolution: true };
      }
    }

    return null;
  }

  private extractMintFromPumpFunLogs(logMessages: string[]): string | null {
    const result = this.extractTokenFromProgramData(logMessages);
    return result.tokenMint && result.tokenMint.length >= 32 ? result.tokenMint : null;
  }

  private extractPoolFromPumpFunLogs(logMessages: string[]): string | undefined {
    const result = this.extractTokenFromProgramData(logMessages);
    return result.poolAddress && result.poolAddress.length >= 32 ? result.poolAddress : undefined;
  }

  private extractTokenFromProgramData(logMessages: string[]): { tokenMint?: string; poolAddress?: string } {
    for (const log of logMessages) {
      if (!log.startsWith('Program data:')) continue;
      const base64 = log.replace(/^Program data:\s*/, '').trim();
      if (!base64 || base64.length < 50) continue;
      try {
        const buf = Buffer.from(base64, 'base64');
        if (buf.length < 8 + 4 + 4 + 4 + 32 + 32 + 32) continue;
        if (buf.subarray(0, 8).compare(LogsListener.CREATE_DISCRIMINATOR) !== 0) continue;
        let offset = 8;
        const readString = (): void => {
          if (offset + 4 > buf.length) return;
          const len = buf.readUInt32LE(offset);
          offset += 4 + len;
        };
        readString();
        readString();
        readString();
        if (offset + 32 + 32 > buf.length) continue;
        const mint = new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
        const bondingCurve = new PublicKey(buf.subarray(offset + 32, offset + 64)).toBase58();
        return { tokenMint: mint, poolAddress: bondingCurve };
      } catch {
        // ignora
      }
    }
    return {};
  }

  private extractTokenFromRaydiumLogs(logMessages: string[]): {
    tokenMint: string;
    poolAddress: string;
    initialLiquiditySOL: number;
  } {
    let tokenMint = '';
    let poolAddress = '';
    let initialLiquiditySOL = 0;

    for (const log of logMessages) {
      const mintMatch = log.match(/mint[=:\s]*([A-Za-z0-9]{32,44})/i);
      if (mintMatch && !tokenMint) tokenMint = mintMatch[1];

      const poolMatch = log.match(/pool[=:\s]*([A-Za-z0-9]{32,44})/i);
      if (poolMatch && !poolAddress) poolAddress = poolMatch[1];

      const liqMatch = log.match(/init_pc_amount:\s*(\d+)/);
      if (liqMatch) initialLiquiditySOL = parseInt(liqMatch[1], 10) / 1_000_000_000;
    }

    return { tokenMint, poolAddress, initialLiquiditySOL };
  }

  private async enqueueForResolution(detected: DetectedToken): Promise<void> {
    const poolDex = detected.source === 'pumpfun' ? 'pumpfun' : 'raydium';
    const payload: TokenScanJobPayload = {
      tokenInfo: { poolDex, source: detected.source },
      source: this.name,
      detectedAt: Date.now(),
      txSignature: detected.signature,
      needsResolution: true,
    };
    await this.queueManager.addJob(QueueName.TOKEN_SCAN, 'token-resolve', payload as unknown as Record<string, unknown>);
    this.tokenCounter++;
    this.poolCounter++;
  }

  private async emitPoolCreated(detected: DetectedToken): Promise<void> {
    const tokenMint = detected.mintAddress!;
    const poolAddress = detected.poolAddress ?? '';
    const minLiq = parseFloat(process.env.MIN_LIQUIDITY_SOL ?? '2');
    const liquiditySol = detected.initialLiquiditySOL ?? 0;

    if (minLiq > 0 && liquiditySol < minLiq) {
      if (Date.now() - this.lastLiquidityBelowAt > LOG_THROTTLE_MS) {
        this.lastLiquidityBelowAt = Date.now();
        logger.debug('LogsListener: token ignorado (liquidez abaixo do mínimo)', {
          liquiditySol,
          minLiquiditySol: minLiq,
          tokenMint: tokenMint.slice(0, 8),
        });
      }
      return;
    }

    const now = Date.now();
    if (now - this.lastDiscoveryLogAt > DISCOVERY_LOG_INTERVAL_MS) {
      this.lastDiscoveryLogAt = now;
      logger.debug('LogsListener: new token discovered', {
        source: detected.source,
        tokenMint: tokenMint.slice(0, 8),
        poolAddress: poolAddress.slice(0, 8),
        initialLiquiditySOL: liquiditySol,
      });
    }

    this.tokenCounter++;
    this.poolCounter++;

    const dex: 'pumpfun' | 'raydium' = detected.source === 'pumpfun' ? 'pumpfun' : 'raydium';
    const poolData: import('../types/pool.types.js').PoolInfo = {
      poolAddress,
      tokenMint,
      quoteMint: '',
      dex,
      liquidity: liquiditySol,
      price: 0,
      volume24h: 0,
      createdAt: new Date(),
      isActive: true,
    };
    this.onEvent({ type: 'POOL_CREATED', timestamp: Date.now(), data: poolData });
  }

  async stop(): Promise<void> {
    this.isActive = false;
    if (this.discoveryHeartbeatInterval) {
      clearInterval(this.discoveryHeartbeatInterval);
      this.discoveryHeartbeatInterval = null;
    }
    const connection = this.connectionManager.getSubscriptionConnection();
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
