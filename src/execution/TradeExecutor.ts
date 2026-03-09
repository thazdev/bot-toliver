import { logger } from '../utils/logger.js';
import { solToLamports } from '../utils/formatters.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { JupiterClient } from './JupiterClient.js';
import { SlippageManager } from './SlippageManager.js';
import { TradeRepository } from '../core/database/repositories/TradeRepository.js';
import { QueueManager } from '../core/queue/QueueManager.js';
import { QueueName } from '../types/queue.types.js';
import { TransactionManager } from '../trading/TransactionManager.js';
import type { TransactionContext } from '../trading/TransactionManager.js';
import type { TradeRequest, TradeResult } from '../types/trade.types.js';
import type { AppConfig } from '../types/config.types.js';
import type { AlertJobPayload } from '../types/queue.types.js';
import { getRealEntryPrice } from '../services/JupiterPriceService.js';
import {
  saveDryRunPosition,
  type DryRunPosition,
} from '../services/DryRunPositionService.js';
import { getTierConfig } from '../strategies/config.js';
import type { PoolScanner } from '../scanners/PoolScanner.js';

const BUY_LOCK_TTL_SEC = parseInt(process.env.BUY_LOCK_TTL_SEC ?? '30', 10);

export interface ExecuteOptions {
  positionId?: string;
  isEmergency?: boolean;
}

export class TradeExecutor {
  private jupiterClient: JupiterClient;
  private slippageManager: SlippageManager;
  private tradeRepository: TradeRepository;
  private connectionManager: ConnectionManager;
  private queueManager: QueueManager;
  private transactionManager: TransactionManager;
  private config: AppConfig;
  private poolScanner: PoolScanner | null;

  constructor(
    config: AppConfig,
    queueManager: QueueManager,
    transactionManager: TransactionManager,
    poolScanner?: PoolScanner | null,
  ) {
    this.config = config;
    this.poolScanner = poolScanner ?? null;
    this.jupiterClient = new JupiterClient(config);
    this.slippageManager = new SlippageManager(config);
    this.tradeRepository = new TradeRepository();
    this.connectionManager = ConnectionManager.getInstance();
    this.queueManager = queueManager;
    this.transactionManager = transactionManager;
  }

  async execute(tradeRequest: TradeRequest, options?: ExecuteOptions): Promise<TradeResult> {
    const startTime = Date.now();

    try {
      if (tradeRequest.direction === 'buy') {
        const blocked = await this.acquireBuyLock(tradeRequest.tokenMint);
        if (blocked) {
          logger.warn('TradeExecutor: duplicate_buy_prevented', {
            tokenMint: tradeRequest.tokenMint,
          });
          const result = this.buildTradeResult(tradeRequest, null, 'cancelled', null, 'Duplicate buy prevented');
          await this.tradeRepository.insert(result);
          return result;
        }
      }

      try {
        return await this.executeInternal(tradeRequest, options, startTime);
      } finally {
        if (tradeRequest.direction === 'buy') {
          await this.releaseBuyLock(tradeRequest.tokenMint);
        }
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TradeExecutor: trade failed', {
        tokenMint: tradeRequest.tokenMint,
        direction: tradeRequest.direction,
        error: errorMsg,
      });

      const result = this.buildTradeResult(tradeRequest, null, 'failed', null, errorMsg);
      await this.tradeRepository.insert(result);
      return result;
    }
  }

  private async executeInternal(
    tradeRequest: TradeRequest,
    options: ExecuteOptions | undefined,
    startTime: number,
  ): Promise<TradeResult> {
    const slippageBps = tradeRequest.slippageBps;

    if (tradeRequest.dryRun) {
      const entryScore = tradeRequest.entryScore ?? 0;
      const finalSize = tradeRequest.amountSol;

      // Preço real: Jupiter Price API primeiro, fallback para pool
      let entryPrice = await getRealEntryPrice(tradeRequest.tokenMint);
      let priceSource = 'jupiter';
      if (entryPrice == null && this.poolScanner) {
        const pool = await this.poolScanner.scanForPool(tradeRequest.tokenMint);
        entryPrice = pool?.price ?? null;
        priceSource = 'pool_estimate';
      }
      if (entryPrice == null || entryPrice <= 0) {
        entryPrice = 0.001; // fallback mínimo para evitar divisão por zero
        priceSource = 'fallback';
      }

      // DRY RUN: simular quote sem chamar Jupiter (valores compatíveis com DB)
      const amountLamports = solToLamports(finalSize).toNumber();
      const amountSol = finalSize;
      const simulatedSlippage = 0.03;
      const tokensPerSol = 1000;
      const quote =
        tradeRequest.direction === 'buy'
          ? {
              inputMint: 'So11111111111111111111111111111111111111112',
              inAmount: amountLamports.toString(),
              outputMint: tradeRequest.tokenMint,
              outAmount: Math.floor(amountSol * (1 - simulatedSlippage) * tokensPerSol).toString(),
              priceImpactPct: (simulatedSlippage * 100).toFixed(4),
              routePlan: [] as unknown[],
            }
          : {
              inputMint: tradeRequest.tokenMint,
              inAmount: (amountLamports * tokensPerSol).toString(),
              outputMint: 'So11111111111111111111111111111111111111112',
              outAmount: Math.floor(amountLamports * (1 - simulatedSlippage)).toString(),
              priceImpactPct: (simulatedSlippage * 100).toFixed(4),
              routePlan: [] as unknown[],
            };

      logger.debug('DRY_RUN_BUY', {
        tokenMint: tradeRequest.tokenMint,
        amountSOL: finalSize,
        entryPrice,
      });

      const result = this.buildTradeResult(
        tradeRequest,
        null,
        'dry_run',
        quote,
        'Simulated — DRY_RUN=true',
      );
      await this.tradeRepository.insert(result);

      // Salvar posição completa no Redis para monitoramento
      if (tradeRequest.direction === 'buy') {
        // Use config values for SL/TP instead of hardcoded
        const tierCfg = getTierConfig(this.config.trading.strategyTier);
        const slPercent = tierCfg.stopLoss.hardStopPercent / 100;
        const tp1Gain = tierCfg.exit.tp1.gainPercent / 100;
        const tp2Gain = tierCfg.exit.tp2.gainPercent / 100;
        const tp3Gain = tierCfg.exit.tp3.gainPercent / 100;

        const dryRunPosition: DryRunPosition = {
          id: `dry_${Date.now()}_${tradeRequest.tokenMint.slice(0, 8)}`,
          tokenMint: tradeRequest.tokenMint,
          entryPrice,
          entryTime: new Date().toISOString(),
          amountSOL: finalSize,
          amountTokens: entryPrice > 0 ? finalSize / entryPrice : 0,
          entryScore,
          strategy: tradeRequest.strategyId,
          tier: this.config.trading.strategyTier,
          stopLossPrice: entryPrice * (1 - slPercent),
          tp1Price: entryPrice * (1 + tp1Gain),
          tp2Price: entryPrice * (1 + tp2Gain),
          tp3Price: entryPrice * (1 + tp3Gain),
          trailingStopPrice: null,
          peakPrice: entryPrice,
          currentPrice: entryPrice,
          currentPnlPct: 0,
          currentPnlSOL: 0,
          status: 'open',
        };
        await saveDryRunPosition(dryRunPosition);

        // Publicar no Redis para o dashboard (Socket.io)
        try {
          const redis = RedisClient.getInstance().getClient();
          await redis.publish(
            'bot:events',
            JSON.stringify({
              type: 'DRY_RUN_BUY',
              tokenMint: tradeRequest.tokenMint,
              amountSOL: finalSize,
              entryScore,
              entryPrice,
              positionId: dryRunPosition.id,
              timestamp: new Date().toISOString(),
            }),
          );
          const rawList = await redis.lrange('diag:passed_tokens_log', 0, 49);
        const updated = rawList.map((s) => {
          try {
            const obj = JSON.parse(s) as { mint: string; tradeExecuted?: boolean };
            if (obj.mint === tradeRequest.tokenMint) {
              return JSON.stringify({ ...obj, tradeExecuted: true });
            }
            return s;
          } catch {
            return s;
          }
        });
        if (updated.some((s, i) => s !== rawList[i])) {
          await redis.del('diag:passed_tokens_log');
          for (let i = updated.length - 1; i >= 0; i--) {
            await redis.lpush('diag:passed_tokens_log', updated[i]);
          }
        }
        } catch (_) {}
      }

      return result;
    }

    const context: TransactionContext = {
      positionId: options?.positionId ?? '',
      type: tradeRequest.direction === 'buy' ? 'BUY' : 'SELL',
      isEmergency: options?.isEmergency ?? false,
    };

    const txResult = await this.transactionManager.executeWithRetry(tradeRequest, context);

    const quote = txResult.success
      ? { inAmount: txResult.inAmount!, outAmount: txResult.outAmount!, priceImpactPct: txResult.priceImpactPct! }
      : null;

    const status = txResult.success ? 'confirmed' : 'failed';
    const result = this.buildTradeResult(
      tradeRequest,
      txResult.signature ?? null,
      status,
      quote,
      txResult.finalError ?? null,
    );
    await this.tradeRepository.insert(result);

    if (txResult.success) {
      await this.queueManager.addJob(QueueName.ALERT, 'trade-confirmed', {
        level: 'trade',
        message: `Trade ${tradeRequest.direction.toUpperCase()} confirmed: ${tradeRequest.amountSol} SOL on ${tradeRequest.tokenMint.slice(0, 8)}...`,
        data: {
          txSignature: txResult.signature,
          direction: tradeRequest.direction,
          amountSol: tradeRequest.amountSol,
        },
      } satisfies AlertJobPayload);

      logger.debug('TradeExecutor: trade completed', {
        txSignature: txResult.signature,
        direction: tradeRequest.direction,
        tokenMint: tradeRequest.tokenMint,
        elapsedMs: Date.now() - startTime,
      });
    }

    return result;
  }

  private async acquireBuyLock(tokenMint: string): Promise<boolean> {
    try {
      const redis = RedisClient.getInstance().getClient();
      const buyLockKey = `buy_lock:${tokenMint}`;
      const alreadyBuying = await redis.get(buyLockKey);
      if (alreadyBuying) return true;
      await redis.set(buyLockKey, '1', 'EX', BUY_LOCK_TTL_SEC);
      return false;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TradeExecutor: Redis buy lock error — proceeding anyway', { error: errorMsg });
      return false;
    }
  }

  private async releaseBuyLock(tokenMint: string): Promise<void> {
    try {
      const redis = RedisClient.getInstance().getClient();
      await redis.del(`buy_lock:${tokenMint}`);
    } catch {
      // Non-critical: lock has TTL and will expire
    }
  }

  private buildTradeResult(
    request: TradeRequest,
    txSignature: string | null,
    status: TradeResult['status'],
    quote: { inAmount: string; outAmount: string; priceImpactPct: string } | null,
    error: string | null,
  ): TradeResult {
    return {
      tradeRequest: request,
      txSignature,
      status,
      inputAmount: quote ? parseInt(quote.inAmount, 10) / 1_000_000_000 : 0,
      outputAmount: quote ? parseInt(quote.outAmount, 10) : 0,
      priceImpact: quote ? parseFloat(quote.priceImpactPct) : 0,
      fee: 0,
      executedAt: new Date(),
      error,
    };
  }
}
