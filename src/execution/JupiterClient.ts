import axios from 'axios';
import { logger } from '../utils/logger.js';
import { WSOL_MINT } from '../utils/constants.js';
import type { AppConfig } from '../types/config.types.js';

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: unknown[];
}

export interface JupiterSwapResponse {
  swapTransaction: string;
}

/**
 * Jupiter aggregator client for quotes and swap transaction generation.
 * Supports both buy (SOL→Token) and sell (Token→SOL) directions.
 */
export class JupiterClient {
  private apiUrl: string;

  constructor(config: AppConfig) {
    this.apiUrl = config.jupiter.apiUrl;
  }

  /**
   * Fetches a swap quote from Jupiter.
   * @param inputMint - Input token mint address
   * @param outputMint - Output token mint address
   * @param amount - Amount in smallest unit (lamports or token base units)
   * @param slippageBps - Slippage tolerance in basis points
   * @returns Jupiter quote response
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
  ): Promise<JupiterQuote> {
    const isDryRun = process.env.DRY_RUN === 'true' || process.env.BOT_DRY_RUN === 'true';
    if (isDryRun) {
      const simulatedSlippage = 0.03;
      const outAmount = Math.floor(amount * (1 - simulatedSlippage) * 1000);
      logger.debug('JupiterClient: DRY_RUN bypass — returning simulated quote', {
        inputMint: inputMint.slice(0, 8),
        outputMint: outputMint.slice(0, 8),
      });
      return {
        inputMint,
        inAmount: amount.toString(),
        outputMint,
        outAmount: outAmount.toString(),
        priceImpactPct: (simulatedSlippage * 100).toFixed(4),
        routePlan: [],
      };
    }

    try {
      const response = await axios.get<JupiterQuote>(`${this.apiUrl}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount: amount.toString(),
          slippageBps,
        },
        timeout: 10000,
      });

      logger.debug('Jupiter quote received', {
        inputMint: inputMint.slice(0, 8),
        outputMint: outputMint.slice(0, 8),
        inAmount: response.data.inAmount,
        outAmount: response.data.outAmount,
        priceImpact: response.data.priceImpactPct,
      });

      return response.data;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Jupiter quote failed', {
        inputMint,
        outputMint,
        amount,
        error: errorMsg,
      });
      throw error;
    }
  }

  /**
   * Fetches a buy quote (SOL → Token).
   * @param tokenMint - The token to buy
   * @param amountLamports - Amount of SOL in lamports
   * @param slippageBps - Slippage tolerance
   * @returns Jupiter quote
   */
  async getBuyQuote(tokenMint: string, amountLamports: number, slippageBps: number): Promise<JupiterQuote> {
    return this.getQuote(WSOL_MINT, tokenMint, amountLamports, slippageBps);
  }

  /**
   * Fetches a sell quote (Token → SOL).
   * @param tokenMint - The token to sell
   * @param tokenAmount - Amount of token in base units
   * @param slippageBps - Slippage tolerance
   * @returns Jupiter quote
   */
  async getSellQuote(tokenMint: string, tokenAmount: number, slippageBps: number): Promise<JupiterQuote> {
    return this.getQuote(tokenMint, WSOL_MINT, tokenAmount, slippageBps);
  }

  /**
   * Executes a swap by getting a serialized transaction from Jupiter.
   * @param quoteResponse - The quote to execute
   * @param userPublicKey - The wallet public key
   * @returns Base64-encoded serialized transaction
   */
  async executeSwap(quoteResponse: JupiterQuote, userPublicKey: string): Promise<string> {
    const isDryRun = process.env.DRY_RUN === 'true' || process.env.BOT_DRY_RUN === 'true';
    if (isDryRun) {
      logger.debug('JupiterClient: DRY_RUN bypass — skipping swap execution');
      throw new Error('DRY_RUN: swap execution skipped');
    }

    try {
      const response = await axios.post<JupiterSwapResponse>(`${this.apiUrl}/swap`, {
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }, {
        timeout: 15000,
      });

      logger.debug('Jupiter swap transaction received', {
        txLength: response.data.swapTransaction.length,
      });

      return response.data.swapTransaction;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Jupiter swap execution failed', { error: errorMsg });
      throw error;
    }
  }
}
