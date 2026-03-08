import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { JupiterClient } from '../execution/JupiterClient.js';
import { TransactionBuilder } from '../execution/TransactionBuilder.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import { DatabaseClient } from '../core/database/DatabaseClient.js';
import { solToLamports } from '../utils/formatters.js';
import type { AppConfig } from '../types/config.types.js';
import type { TradeRequest } from '../types/trade.types.js';

const SELL_RETRY_DELAY_MS = parseInt(process.env.SELL_RETRY_DELAY_MS ?? '2000', 10);
const SELL_MAX_RETRIES = parseInt(process.env.SELL_MAX_RETRIES ?? '3', 10);
const BUY_MAX_RETRIES = parseInt(process.env.BUY_MAX_RETRIES ?? '2', 10);
const EMERGENCY_SLIPPAGE_BPS = parseInt(process.env.EMERGENCY_SLIPPAGE_PCT ?? '50', 10) * 100;
const MAX_BLOCKHASH_RENEWALS = parseInt(process.env.MAX_BLOCKHASH_RENEWALS ?? '2', 10);

export interface TransactionContext {
  positionId: string;
  type: 'BUY' | 'SELL';
  isEmergency: boolean;
}

export interface TransactionResult {
  success: boolean;
  signature?: string;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: string;
  finalError?: string;
}

export class TransactionManager {
  private jupiterClient: JupiterClient;
  private connectionManager: ConnectionManager;
  private onTokenFailure?: (tokenMint: string) => void;

  constructor(config: AppConfig, onTokenFailure?: (tokenMint: string) => void) {
    this.jupiterClient = new JupiterClient(config);
    this.connectionManager = ConnectionManager.getInstance();
    this.onTokenFailure = onTokenFailure;
  }

  async executeWithRetry(
    request: TradeRequest,
    context: TransactionContext,
  ): Promise<TransactionResult> {
    const envDryRun = process.env.DRY_RUN === 'true' || process.env.BOT_DRY_RUN === 'true';
    if (request.dryRun || envDryRun) {
      const amountLamports = solToLamports(request.amountSol).toNumber();
      const simulatedOut = Math.floor(amountLamports * 0.97 * 1000);
      logger.info('TransactionManager: DRY_RUN bypass — no Jupiter call, no retry', {
        tokenMint: request.tokenMint.slice(0, 12),
        direction: context.type,
        amountSOL: request.amountSol,
      });
      return {
        success: true,
        signature: `dry_run_${Date.now()}_${request.tokenMint.slice(0, 8)}`,
        inAmount: amountLamports.toString(),
        outAmount: simulatedOut.toString(),
        priceImpactPct: '3.0',
      };
    }

    const maxRetries = context.type === 'SELL' ? SELL_MAX_RETRIES : BUY_MAX_RETRIES;
    let attempt = 0;
    let blockhashRenewals = 0;
    let lastError = '';

    while (attempt < maxRetries) {
      attempt++;

      try {
        const slippageBps = this.getSlippageForAttempt(
          request.slippageBps,
          attempt,
          context.type,
          context.isEmergency,
        );

        logger.info('TransactionManager: executing attempt', {
          attempt,
          maxRetries,
          type: context.type,
          tokenMint: request.tokenMint.slice(0, 8),
          slippageBps,
          isEmergency: context.isEmergency,
        });

        return await this.executeSingleAttempt(request, slippageBps);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        lastError = errorMsg;

        if (this.isBlockhashError(errorMsg) && blockhashRenewals < MAX_BLOCKHASH_RENEWALS) {
          blockhashRenewals++;
          logger.warn('TransactionManager: blockhash expired, renewing immediately', {
            tokenMint: request.tokenMint.slice(0, 8),
            renewal: blockhashRenewals,
            maxRenewals: MAX_BLOCKHASH_RENEWALS,
            type: context.type,
          });
          attempt--;
          continue;
        }

        logger.error(`TransactionManager: attempt ${attempt}/${maxRetries} failed`, {
          tokenMint: request.tokenMint.slice(0, 8),
          type: context.type,
          positionId: context.positionId,
          error: errorMsg,
          attempt,
        });

        if (attempt < maxRetries && context.type === 'SELL') {
          const waitMs = SELL_RETRY_DELAY_MS * attempt;
          logger.info('TransactionManager: waiting before next sell retry', { waitMs });
          await sleep(waitMs);
        }
      }
    }

    if (context.type === 'SELL') {
      logger.error('TransactionManager: sell_failed_critical', {
        positionId: context.positionId,
        tokenMint: request.tokenMint,
        error: lastError,
        totalAttempts: maxRetries,
      });
      this.onTokenFailure?.(request.tokenMint);
      await this.emergencyFallback(context.positionId, request);
    } else {
      logger.error('TransactionManager: buy_failed', {
        tokenMint: request.tokenMint,
        error: lastError,
        totalAttempts: maxRetries,
      });
      this.onTokenFailure?.(request.tokenMint);
    }

    return { success: false, finalError: lastError };
  }

  private getSlippageForAttempt(
    baseBps: number,
    attempt: number,
    type: 'BUY' | 'SELL',
    isEmergency: boolean,
  ): number {
    if (type === 'BUY') return baseBps;
    if (isEmergency) return EMERGENCY_SLIPPAGE_BPS;

    switch (attempt) {
      case 1:
        return baseBps;
      case 2:
        return baseBps + 500;
      case 3:
        return baseBps + 1000;
      default:
        return baseBps + 1000;
    }
  }

  private async executeSingleAttempt(
    request: TradeRequest,
    slippageBps: number,
  ): Promise<TransactionResult> {
    const connection = this.connectionManager.getConnection();
    const wallet = this.connectionManager.getWallet();
    const rateLimiter = this.connectionManager.getRateLimiter();

    const amountLamports = solToLamports(request.amountSol).toNumber();

    const quote = request.direction === 'buy'
      ? await this.jupiterClient.getBuyQuote(request.tokenMint, amountLamports, slippageBps)
      : await this.jupiterClient.getSellQuote(request.tokenMint, amountLamports, slippageBps);

    const priceImpact = parseFloat(quote.priceImpactPct);
    if (priceImpact > 10) {
      throw new Error(`Price impact too high: ${priceImpact.toFixed(2)}%`);
    }

    const swapTx = await this.jupiterClient.executeSwap(quote, wallet.publicKey.toBase58());
    const signedTx = TransactionBuilder.buildAndSign(swapTx, wallet);
    const rawTx = signedTx.serialize();

    const txSignature = await rateLimiter.schedule(() =>
      connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
        maxRetries: 2,
      }),
    );

    const confirmation = await rateLimiter.schedule(() =>
      connection.confirmTransaction(txSignature, 'confirmed'),
    );

    if (confirmation.value.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
    }

    logger.info('TransactionManager: transaction confirmed', {
      signature: txSignature,
      direction: request.direction,
      tokenMint: request.tokenMint.slice(0, 8),
    });

    return {
      success: true,
      signature: txSignature,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      priceImpactPct: quote.priceImpactPct,
    };
  }

  private isBlockhashError(errorMsg: string): boolean {
    const lower = errorMsg.toLowerCase();
    return lower.includes('blockhashnotfound')
      || lower.includes('transactionexpiredblockheightexceedederror')
      || lower.includes('blockhash not found')
      || lower.includes('block height exceeded');
  }

  private async emergencyFallback(positionId: string, request: TradeRequest): Promise<void> {
    logger.error('TransactionManager: entering emergency fallback', {
      positionId,
      tokenMint: request.tokenMint,
    });

    try {
      const result = await this.executeSingleAttempt(
        { ...request, slippageBps: EMERGENCY_SLIPPAGE_BPS },
        EMERGENCY_SLIPPAGE_BPS,
      );
      if (result.success) {
        logger.info('TransactionManager: emergency fallback sell succeeded', {
          positionId,
          signature: result.signature,
        });
        return;
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TransactionManager: emergency fallback attempt failed', {
        positionId,
        tokenMint: request.tokenMint,
        error: errorMsg,
      });
    }

    try {
      const db = DatabaseClient.getInstance();
      await db.execute(
        "UPDATE positions SET status = 'stuck' WHERE id = ?",
        [positionId],
      );
      logger.error('TransactionManager: position marked as STUCK in database', { positionId });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TransactionManager: failed to mark position as STUCK in DB', {
        positionId,
        error: errorMsg,
      });
    }

    try {
      const redis = RedisClient.getInstance().getClient();
      await redis.set(
        `stuck_position:${positionId}`,
        JSON.stringify({
          positionId,
          tokenMint: request.tokenMint,
          stuckAt: new Date().toISOString(),
        }),
        'EX',
        86400,
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TransactionManager: failed to save stuck position in Redis', {
        positionId,
        error: errorMsg,
      });
    }

    logger.error('CRITICAL: Position STUCK — human intervention required', {
      positionId,
      tokenMint: request.tokenMint,
      action: 'MANUAL_SELL_REQUIRED',
      message: 'DO NOT ignore — this position could not be sold after all retry attempts',
    });

    this.onTokenFailure?.(request.tokenMint);
  }

  static async getStuckPositionKeys(): Promise<string[]> {
    try {
      const redis = RedisClient.getInstance().getClient();
      return await redis.keys('stuck_position:*');
    } catch {
      return [];
    }
  }
}
