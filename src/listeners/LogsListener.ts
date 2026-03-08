import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { BotHealthMonitor } from '../monitoring/BotHealthMonitor.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';
import { isConnectionsPaused } from '../config/ConnectionsPausedResolver.js';
import { logger } from '../utils/logger.js';
import {
  RAYDIUM_AMM_V4,
  PUMP_FUN_PROGRAM,
} from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

const RAYDIUM_CLMM = process.env.RAYDIUM_CLMM_PROGRAM ?? 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';

interface DiscoveredToken {
  tokenMint: string;
  poolAddress: string;
  blockTime: number;
  initialLiquiditySOL: number;
  source: 'raydium' | 'raydium_clmm' | 'pumpfun';
}

const LOG_THROTTLE_MS = 30_000; // 30s para logs de diagnóstico repetitivos
const DISCOVERY_LOG_INTERVAL_MS = 15_000; // 15s para "new token discovered"

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
            if (!this.isActive) return;
            void this.processLogs(program.name, logs);
          },
          commitment,
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

  private async processLogs(programName: string, logs: Logs): Promise<void> {
    if (!this.isActive || isConnectionsPaused() || !(await isBotEnabled())) return;
    BotHealthMonitor.recordEvent();
    this.logBatchCount++;
    const now = Date.now();
    if (now - this.lastLogInfoAt > 60_000) {
      logger.info('LogsListener: WebSocket recebendo logs', {
        batchesReceived: this.logBatchCount,
        program: programName,
      });
      this.lastLogInfoAt = now;
    }

    try {
      const logMessages = logs.logs;
      const signature = logs.signature;
      const processStartMs = Date.now();

      if (programName.includes('Raydium')) {
        await this.processRaydiumLogs(programName, logMessages, signature, processStartMs);
      } else if (programName.includes('Pump')) {
        await this.processPumpFunLogs(logMessages, signature, processStartMs);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('LogsListener: error processing logs', {
        program: programName,
        error: errorMsg,
      });
    }
  }

  private async processRaydiumLogs(
    programName: string,
    logMessages: string[],
    signature: string,
    processStartMs: number,
  ): Promise<void> {
    const hasInitialize2 = logMessages.some(
      (log) => log.includes('initialize2') || log.includes('Initialize2'),
    );

    if (!hasInitialize2) return;

    const discovered = this.extractTokenFromLogs(logMessages);
    const source = programName.includes('CLMM') ? 'raydium_clmm' : 'raydium';

    await this.fetchBlockTimeAndEmit(signature, discovered, source, processStartMs);
  }

  private async processPumpFunLogs(
    logMessages: string[],
    signature: string,
    processStartMs: number,
  ): Promise<void> {
    const pumpProgramPrefix = `Program ${PUMP_FUN_PROGRAM}`;
    const isPumpFunInvocation = logMessages.some((log) => log.startsWith(pumpProgramPrefix));
    if (!isPumpFunInvocation) return;

    const hasCreate = logMessages.some(
      (log) => log.includes('Program log: Create') || log.includes('Program log: create'),
    );
    const hasMintTo = logMessages.some((log) => log.includes('MintTo'));
    const hasInitializeAccount = logMessages.some((log) => log.includes('InitializeAccount'));

    if (!hasCreate && !(hasMintTo && hasInitializeAccount)) return;

    const discovered = this.extractTokenFromLogs(logMessages);

    await this.fetchBlockTimeAndEmit(signature, discovered, 'pumpfun', processStartMs);
  }

  private extractTokenFromLogs(logMessages: string[]): Partial<DiscoveredToken> {
    let tokenMint = '';
    let poolAddress = '';
    let initialLiquiditySOL = 0;

    for (const log of logMessages) {
      const mintMatch = log.match(/mint:\s*([A-Za-z0-9]{32,44})/);
      if (mintMatch && !tokenMint) {
        tokenMint = mintMatch[1];
      }

      const poolMatch = log.match(/pool:\s*([A-Za-z0-9]{32,44})/);
      if (poolMatch && !poolAddress) {
        poolAddress = poolMatch[1];
      }

      const liqMatch = log.match(/init_pc_amount:\s*(\d+)/);
      if (liqMatch) {
        initialLiquiditySOL = parseInt(liqMatch[1], 10) / 1_000_000_000;
      }
    }

    return { tokenMint, poolAddress, initialLiquiditySOL };
  }

  private async fetchBlockTimeAndEmit(
    signature: string,
    discovered: Partial<DiscoveredToken>,
    source: 'raydium' | 'raydium_clmm' | 'pumpfun',
    processStartMs: number,
  ): Promise<void> {
    try {
      let blockTime = Math.floor(Date.now() / 1000);
      const hasTokenFromLogs = !!(discovered.tokenMint && discovered.tokenMint.length >= 32);

      if (!hasTokenFromLogs) {
        const connection = this.connectionManager.getConnection();
        const rateLimiter = this.connectionManager.getRateLimiter();
        try {
          const tx = await rateLimiter.schedule(() =>
            connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 }),
          );
          if (tx?.blockTime) blockTime = tx.blockTime;
          if (tx?.transaction?.message) {
            const accountKeys = tx.transaction.message.getAccountKeys
              ? tx.transaction.message.getAccountKeys().staticAccountKeys
              : [];
            if (accountKeys.length > 0 && !discovered.tokenMint) {
              discovered.tokenMint = accountKeys[accountKeys.length - 1]?.toBase58() ?? '';
            }
            if (accountKeys.length > 1 && !discovered.poolAddress) {
              discovered.poolAddress = accountKeys[1]?.toBase58() ?? '';
            }
          }
        } catch {
          if (Date.now() - this.lastFetchTxErrorAt > LOG_THROTTLE_MS) {
            this.lastFetchTxErrorAt = Date.now();
            logger.debug('LogsListener: could not fetch tx details, using Date.now()', { signature });
          }
        }
      }

      const latencyMs = Date.now() - (blockTime * 1000);

      const now = Date.now();
      if (now - this.lastDiscoveryLogAt > DISCOVERY_LOG_INTERVAL_MS) {
        this.lastDiscoveryLogAt = now;
        logger.info('LogsListener: new token discovered', {
          source,
          tokenMint: (discovered.tokenMint ?? '').slice(0, 8),
          poolAddress: (discovered.poolAddress ?? '').slice(0, 8),
          initialLiquiditySOL: discovered.initialLiquiditySOL ?? 0,
          discoveryLatencyMs: latencyMs,
        });
      }

      const latencyThreshold = parseInt(process.env.DISCOVERY_LATENCY_WARN_MS ?? '5000', 10);
      if (latencyMs > latencyThreshold && Date.now() - this.lastLatencyWarnAt > LOG_THROTTLE_MS) {
        this.lastLatencyWarnAt = Date.now();
        logger.debug('LogsListener: discovery latency alta (queue pode estar cheia)', {
          latencyMs,
          source,
          tokenMint: (discovered.tokenMint ?? '').slice(0, 8),
        });
      }

      const poolAddress = discovered.poolAddress ?? '';
      const tokenMint = discovered.tokenMint ?? '';
      if (!tokenMint || tokenMint.length < 32) {
        if (Date.now() - this.lastNoTokenMintAt > LOG_THROTTLE_MS) {
          this.lastNoTokenMintAt = Date.now();
          logger.debug('LogsListener: ignorando discovery sem tokenMint', { poolAddress: poolAddress.slice(0, 8) });
        }
        return;
      }
      const liquiditySol = discovered.initialLiquiditySOL ?? 0;
      const minLiq = parseFloat(process.env.MIN_LIQUIDITY_SOL ?? '0');
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

      const dex: 'pumpfun' | 'raydium' = source === 'pumpfun' ? 'pumpfun' : 'raydium';
      const poolData: import('../types/pool.types.js').PoolInfo = {
        poolAddress,
        tokenMint,
        quoteMint: '',
        dex,
        liquidity: liquiditySol,
        price: 0,
        volume24h: 0,
        createdAt: new Date(blockTime * 1000),
        isActive: true,
      };
      // Emite apenas POOL_CREATED (evita job duplicado — antes emitíamos POOL_CREATED + TOKEN_DETECTED)
      this.onEvent({ type: 'POOL_CREATED', timestamp: blockTime * 1000, data: poolData });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('LogsListener: failed to fetch block time and emit', {
        signature,
        source,
        error: errorMsg,
      });
    }
  }

  async stop(): Promise<void> {
    this.isActive = false;
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
