import { PublicKey } from '@solana/web3.js';
import { BaseListener } from './BaseListener.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { BotHealthMonitor } from '../monitoring/BotHealthMonitor.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';
import { logger } from '../utils/logger.js';
import { RAYDIUM_AMM_V4, PUMP_FUN_PROGRAM } from '../utils/constants.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

const RAYDIUM_CLMM = process.env.RAYDIUM_CLMM_PROGRAM ?? 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';

const POLL_INTERVAL_MS = parseInt(process.env.POLLING_FALLBACK_INTERVAL_MS ?? '180000', 10); // 3 min
const MAX_SIGNATURES_PER_POLL = 3;
const SEEN_CAP = 500;

interface DiscoveredToken {
  tokenMint: string;
  poolAddress: string;
  initialLiquiditySOL: number;
}

/**
 * Fallback quando WebSocket (onLogs) não recebe eventos.
 * Usa getSignaturesForAddress + getTransaction para detectar novos pools.
 * Ativar com POLLING_FALLBACK_ENABLED=true.
 */
export class PollingFallbackListener extends BaseListener {
  private timer: ReturnType<typeof setInterval> | null = null;
  private connectionManager: ConnectionManager;
  private seenSignatures = new Set<string>();

  constructor(queueManager: QueueManager) {
    super('PollingFallbackListener', queueManager);
    this.connectionManager = ConnectionManager.getInstance();
  }

  async start(): Promise<void> {
    const enabled = /^(true|1|yes)$/i.test(String(process.env.POLLING_FALLBACK_ENABLED ?? '').trim());
    if (!enabled) {
      logger.info('PollingFallbackListener: desativado. Ative com POLLING_FALLBACK_ENABLED=true');
      console.log('[PollingFallback] Desativado — defina POLLING_FALLBACK_ENABLED=true no Railway (variáveis do BOT)');
      return;
    }

    this.isActive = true;
    console.log('[PollingFallback] ATIVO — detectando pools via polling a cada', POLL_INTERVAL_MS / 1000, 'segundos');
    logger.info('PollingFallbackListener: INICIADO (fallback ativo)', {
      intervalMs: POLL_INTERVAL_MS,
      programs: ['Raydium AMM', 'PumpFun', 'Raydium CLMM'],
    });
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    setTimeout(() => this.poll().catch((e) => logger.debug('PollingFallbackListener: erro no primeiro poll', { err: String(e) })), 10_000);
  }

  private async poll(): Promise<void> {
    if (!this.isActive) return;
    if (!(await isBotEnabled())) return;

    let totalChecked = 0;
    const programs = [
      { name: 'Raydium AMM V4', id: RAYDIUM_AMM_V4 },
      { name: 'Pump.fun', id: PUMP_FUN_PROGRAM },
      { name: 'Raydium CLMM', id: RAYDIUM_CLMM },
    ];

    const connection = this.connectionManager.getConnection();
    const rateLimiter = this.connectionManager.getRateLimiter();

    for (const program of programs) {
      try {
        const sigs = await rateLimiter.schedule(() =>
          connection.getSignaturesForAddress(new PublicKey(program.id), {
            limit: MAX_SIGNATURES_PER_POLL,
          }),
        );

        for (const sig of sigs) {
          totalChecked++;
          if (!sig.signature || this.seenSignatures.has(sig.signature)) continue;
          if (this.seenSignatures.size >= SEEN_CAP) {
            const first = this.seenSignatures.values().next().value;
            if (first) this.seenSignatures.delete(first);
          }
          this.seenSignatures.add(sig.signature);

          const tx = await rateLimiter.schedule(() =>
            connection.getTransaction(sig.signature, { maxSupportedTransactionVersion: 0 }),
          );
          if (!tx?.meta?.logMessages) continue;

          const logMessages = tx.meta.logMessages as string[];
          const source = program.name.includes('Pump') ? 'pumpfun' : program.name.includes('CLMM') ? 'raydium_clmm' : 'raydium';

          let discovered = this.parseLogs(logMessages, program.name);
          if (!discovered) continue;

          if (!discovered.tokenMint || !discovered.poolAddress) {
            const keys = tx.transaction?.message?.getAccountKeys?.()?.staticAccountKeys ?? [];
            if (keys.length > 0 && !discovered.tokenMint) discovered.tokenMint = keys[keys.length - 1]?.toBase58() ?? '';
            if (keys.length > 1 && !discovered.poolAddress) discovered.poolAddress = keys[1]?.toBase58() ?? '';
          }

          BotHealthMonitor.recordEvent();
          const blockTime = tx.blockTime ?? Math.floor(Date.now() / 1000);

          const poolData: import('../types/pool.types.js').PoolInfo = {
            poolAddress: discovered.poolAddress,
            tokenMint: discovered.tokenMint,
            quoteMint: '',
            dex: source === 'pumpfun' ? 'pumpfun' : 'raydium',
            liquidity: discovered.initialLiquiditySOL,
            price: 0,
            volume24h: 0,
            createdAt: new Date(blockTime * 1000),
            isActive: true,
          };
          this.onEvent({ type: 'POOL_CREATED', timestamp: blockTime * 1000, data: poolData });

          if (discovered.tokenMint) {
            const tokenData: import('../types/token.types.js').TokenInfo = {
              mintAddress: discovered.tokenMint,
              poolAddress: discovered.poolAddress || undefined,
              dex: source === 'pumpfun' ? 'pumpfun' : 'raydium',
              symbol: '',
              name: '',
              decimals: 0,
              supply: '0',
              createdAt: new Date(blockTime * 1000),
              source: source === 'pumpfun' ? 'pumpfun' : source === 'raydium_clmm' ? 'raydium_clmm' : 'raydium',
              initialLiquidity: discovered.initialLiquiditySOL,
              initialPrice: 0,
              isMutable: false,
              hasFreezable: false,
              metadataUri: '',
            };
            this.onEvent({ type: 'TOKEN_DETECTED', timestamp: blockTime * 1000, data: tokenData });
          }

          logger.info('PollingFallbackListener: pool detectado via polling', {
            source,
            tokenMint: discovered.tokenMint.slice(0, 8),
            signature: sig.signature.slice(0, 16),
          });
        }
      } catch (error: unknown) {
        const err = error instanceof Error ? error.message : String(error);
        logger.debug('PollingFallbackListener: erro no poll', { program: program.name, error: err });
      }
    }

    logger.info('PollingFallbackListener: poll executado', { signaturesVerificadas: totalChecked });
  }

  private parseLogs(logMessages: string[], programName: string): DiscoveredToken | null {
    let tokenMint = '';
    let poolAddress = '';
    let initialLiquiditySOL = 0;

    if (programName.includes('Raydium')) {
      const hasInit = logMessages.some((l) => l.includes('initialize2') || l.includes('Initialize2'));
      if (!hasInit) return null;
    } else if (programName.includes('Pump')) {
      const hasCreate = logMessages.some((l) => l.includes('Program log: Create') || l.includes('Program log: create'));
      const hasMintTo = logMessages.some((l) => l.includes('MintTo'));
      const hasInitAcc = logMessages.some((l) => l.includes('InitializeAccount'));
      if (!hasCreate && !(hasMintTo && hasInitAcc)) return null;
    } else {
      return null;
    }

    for (const log of logMessages) {
      const mintMatch = log.match(/mint:\s*([A-Za-z0-9]{32,44})/);
      if (mintMatch && !tokenMint) tokenMint = mintMatch[1];
      const poolMatch = log.match(/pool:\s*([A-Za-z0-9]{32,44})/);
      if (poolMatch && !poolAddress) poolAddress = poolMatch[1];
      const liqMatch = log.match(/init_pc_amount:\s*(\d+)/);
      if (liqMatch) initialLiquiditySOL = parseInt(liqMatch[1], 10) / 1_000_000_000;
    }

    if (!tokenMint && !poolAddress) return null;
    return { tokenMint, poolAddress, initialLiquiditySOL };
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.seenSignatures.clear();
    await super.stop();
  }
}
