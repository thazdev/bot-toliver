import { PublicKey, type Logs } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { BotHealthMonitor } from '../monitoring/BotHealthMonitor.js';
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

export class LogsListener extends BaseListener {
  private subscriptionIds: number[] = [];
  private connectionManager: ConnectionManager;

  constructor(queueManager: QueueManager) {
    super('LogsListener', queueManager);
    this.connectionManager = ConnectionManager.getInstance();
  }

  async start(): Promise<void> {
    this.isActive = true;
    const connection = this.connectionManager.getConnection();

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
            this.processLogs(program.name, logs);
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

  private processLogs(programName: string, logs: Logs): void {
    BotHealthMonitor.recordEvent();

    try {
      const logMessages = logs.logs;
      const signature = logs.signature;
      const processStartMs = Date.now();

      if (programName.includes('Raydium')) {
        this.processRaydiumLogs(programName, logMessages, signature, processStartMs);
      } else if (programName.includes('Pump')) {
        this.processPumpFunLogs(logMessages, signature, processStartMs);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('LogsListener: error processing logs', {
        program: programName,
        error: errorMsg,
      });
    }
  }

  private processRaydiumLogs(
    programName: string,
    logMessages: string[],
    signature: string,
    processStartMs: number,
  ): void {
    const hasInitialize2 = logMessages.some(
      (log) => log.includes('initialize2') || log.includes('Initialize2'),
    );

    if (!hasInitialize2) return;

    const discovered = this.extractTokenFromLogs(logMessages);
    const source = programName.includes('CLMM') ? 'raydium_clmm' : 'raydium';

    this.fetchBlockTimeAndEmit(signature, discovered, source, processStartMs);
  }

  private processPumpFunLogs(
    logMessages: string[],
    signature: string,
    processStartMs: number,
  ): void {
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

    this.fetchBlockTimeAndEmit(signature, discovered, 'pumpfun', processStartMs);
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
      const connection = this.connectionManager.getConnection();

      let blockTime = Math.floor(Date.now() / 1000);
      try {
        const tx = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (tx?.blockTime) {
          blockTime = tx.blockTime;
        }

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
        logger.debug('LogsListener: could not fetch tx details, using Date.now()', { signature });
      }

      const latencyMs = Date.now() - (blockTime * 1000);

      logger.info('LogsListener: new token discovered', {
        source,
        tokenMint: (discovered.tokenMint ?? '').slice(0, 8),
        poolAddress: (discovered.poolAddress ?? '').slice(0, 8),
        blockTime,
        initialLiquiditySOL: discovered.initialLiquiditySOL ?? 0,
        discoveryLatencyMs: latencyMs,
        processLatencyMs: Date.now() - processStartMs,
        signature: signature.slice(0, 16),
      });

      if (latencyMs > 2000) {
        logger.warn('LogsListener: discovery latency exceeds 2s target', {
          latencyMs,
          source,
          tokenMint: (discovered.tokenMint ?? '').slice(0, 8),
        });
      }

      this.onEvent({
        type: 'POOL_CREATED',
        timestamp: blockTime * 1000,
        data: {
          poolAddress: discovered.poolAddress ?? '',
          tokenMint: discovered.tokenMint ?? '',
          quoteMint: '',
          dex: source === 'pumpfun' ? 'pumpfun' : 'raydium',
          liquidity: discovered.initialLiquiditySOL ?? 0,
          price: 0,
          volume24h: 0,
          createdAt: new Date(blockTime * 1000),
          isActive: true,
        },
      });

      if (discovered.tokenMint) {
        this.onEvent({
          type: 'TOKEN_DETECTED',
          timestamp: blockTime * 1000,
          data: {
            mintAddress: discovered.tokenMint,
            symbol: '',
            name: '',
            decimals: 0,
            supply: '0',
            createdAt: new Date(blockTime * 1000),
            source,
            initialLiquidity: discovered.initialLiquiditySOL ?? 0,
            initialPrice: 0,
            isMutable: false,
            hasFreezable: false,
            metadataUri: '',
          },
        });
      }
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
