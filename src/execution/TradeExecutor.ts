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

  constructor(config: AppConfig, queueManager: QueueManager, transactionManager: TransactionManager) {
    this.config = config;
    this.jupiterClient = new JupiterClient(config);
    this.slippageManager = new SlippageManager(config);
    this.tradeRepository = new TradeRepository();
    this.connectionManager = ConnectionManager.getInstance();
    this.queueManager = queueManager;
    this.transactionManager = transactionManager;
  }

  async execute(tradeRequest: TradeRequest, options?: ExecuteOptions): Promise<TradeResult> {
    const startTime = Date.now();
    logger.info('TradeExecutor: starting trade', {
      tokenMint: tradeRequest.tokenMint,
      direction: tradeRequest.direction,
      amountSol: tradeRequest.amountSol,
      dryRun: tradeRequest.dryRun,
    });

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
      try {
        const debugToken = await RedisClient.getInstance().getClient().get('debug:last_passed_token');
        if (debugToken && tradeRequest.tokenMint === debugToken) {
          logger.info('DEBUG_TRACE: DRY_RUN_INTERCEPTED', {
            tokenMint: tradeRequest.tokenMint.slice(0, 12),
            wouldBuy: tradeRequest.amountSol,
          });
        }
      } catch (_) {}

      const amountLamports = solToLamports(tradeRequest.amountSol).toNumber();
      const quote = tradeRequest.direction === 'buy'
        ? await this.jupiterClient.getBuyQuote(tradeRequest.tokenMint, amountLamports, slippageBps)
        : await this.jupiterClient.getSellQuote(tradeRequest.tokenMint, amountLamports, slippageBps);

      logger.info('🔵 DRY RUN TRADE — would have executed', {
        direction: tradeRequest.direction,
        tokenMint: tradeRequest.tokenMint,
        amountSOL: tradeRequest.amountSol,
        reason: 'dry_run_simulated',
      });

      const result = this.buildTradeResult(
        tradeRequest,
        null,
        'dry_run',
        quote,
        'Simulated — DRY_RUN=true',
      );
      await this.tradeRepository.insert(result);
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

      logger.info('TradeExecutor: trade completed', {
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
