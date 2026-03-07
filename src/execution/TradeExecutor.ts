import { logger } from '../utils/logger.js';
import { solToLamports } from '../utils/formatters.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { JupiterClient } from './JupiterClient.js';
import { TransactionBuilder } from './TransactionBuilder.js';
import { TransactionSender } from './TransactionSender.js';
import { SlippageManager } from './SlippageManager.js';
import { TradeRepository } from '../core/database/repositories/TradeRepository.js';
import { QueueManager } from '../core/queue/QueueManager.js';
import { QueueName } from '../types/queue.types.js';
import type { TradeRequest, TradeResult } from '../types/trade.types.js';
import type { AppConfig } from '../types/config.types.js';
import type { AlertJobPayload } from '../types/queue.types.js';

/**
 * Orchestrates the full trade lifecycle: quote, validate, execute, and record.
 * Consumes TRADE_EXECUTE queue jobs.
 */
export class TradeExecutor {
  private jupiterClient: JupiterClient;
  private transactionSender: TransactionSender;
  private slippageManager: SlippageManager;
  private tradeRepository: TradeRepository;
  private connectionManager: ConnectionManager;
  private queueManager: QueueManager;
  private config: AppConfig;

  constructor(config: AppConfig, queueManager: QueueManager) {
    this.config = config;
    this.jupiterClient = new JupiterClient(config);
    this.transactionSender = new TransactionSender();
    this.slippageManager = new SlippageManager(config);
    this.tradeRepository = new TradeRepository();
    this.connectionManager = ConnectionManager.getInstance();
    this.queueManager = queueManager;
  }

  /**
   * Executes a trade request through the full lifecycle.
   * @param tradeRequest - The trade to execute
   * @param poolLiquidity - Current pool liquidity for slippage calculation
   * @returns The trade result
   */
  async execute(tradeRequest: TradeRequest, poolLiquidity: number = 0): Promise<TradeResult> {
    const startTime = Date.now();
    logger.info('TradeExecutor: starting trade', {
      tokenMint: tradeRequest.tokenMint,
      direction: tradeRequest.direction,
      amountSol: tradeRequest.amountSol,
      dryRun: tradeRequest.dryRun,
    });

    try {
      const slippageBps = poolLiquidity > 0
        ? this.slippageManager.calculateSlippage(poolLiquidity, tradeRequest.amountSol)
        : tradeRequest.slippageBps;

      const amountLamports = solToLamports(tradeRequest.amountSol).toNumber();

      const quote = tradeRequest.direction === 'buy'
        ? await this.jupiterClient.getBuyQuote(tradeRequest.tokenMint, amountLamports, slippageBps)
        : await this.jupiterClient.getSellQuote(tradeRequest.tokenMint, amountLamports, slippageBps);

      const priceImpact = parseFloat(quote.priceImpactPct);

      if (priceImpact > 10) {
        logger.warn('TradeExecutor: high price impact, aborting', {
          priceImpact,
          tokenMint: tradeRequest.tokenMint,
        });
        const result = this.buildTradeResult(tradeRequest, null, 'cancelled', quote, 'Price impact too high');
        await this.tradeRepository.insert(result);
        return result;
      }

      if (tradeRequest.dryRun) {
        logger.info('TradeExecutor: DRY RUN - would have executed trade', {
          tokenMint: tradeRequest.tokenMint,
          direction: tradeRequest.direction,
          inAmount: quote.inAmount,
          outAmount: quote.outAmount,
          priceImpact,
        });
        const result = this.buildTradeResult(tradeRequest, null, 'confirmed', quote, null);
        await this.tradeRepository.insert(result);
        return result;
      }

      const wallet = this.connectionManager.getWallet();
      const swapTx = await this.jupiterClient.executeSwap(quote, wallet.publicKey.toBase58());
      const signedTx = TransactionBuilder.buildAndSign(swapTx, wallet);
      const txSignature = await this.transactionSender.sendAndConfirm(signedTx);

      const result = this.buildTradeResult(tradeRequest, txSignature, 'confirmed', quote, null);
      await this.tradeRepository.insert(result);

      await this.queueManager.addJob(QueueName.ALERT, 'trade-confirmed', {
        level: 'trade',
        message: `Trade ${tradeRequest.direction.toUpperCase()} confirmed: ${tradeRequest.amountSol} SOL on ${tradeRequest.tokenMint.slice(0, 8)}...`,
        data: { txSignature, direction: tradeRequest.direction, amountSol: tradeRequest.amountSol },
      } satisfies AlertJobPayload);

      logger.info('TradeExecutor: trade completed', {
        txSignature,
        direction: tradeRequest.direction,
        tokenMint: tradeRequest.tokenMint,
        elapsedMs: Date.now() - startTime,
      });

      return result;
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
