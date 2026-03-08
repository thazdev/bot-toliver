// UPDATED: Honeypot tax threshold 50% -> 30% - 2026-03-07
import { logger } from '../utils/logger.js';
import { getTierConfig, type HoneypotConfig } from '../strategies/config.js';
import type {
  StrategyTier,
  HoneypotCheckResult,
  SafetyData,
} from '../types/strategy.types.js';

interface SwapSimulationResult {
  success: boolean;
  outputAmount: number;
  inputAmount: number;
}

interface JupiterSimulator {
  simulateSwap(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
  }): Promise<SwapSimulationResult>;
}

interface TokenMintData {
  freezeAuthority: string | null;
  mintAuthority: string | null;
}

interface SellTransaction {
  success: boolean;
  wallet: string;
  timestamp: number;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export class HoneypotChecker {
  private config: HoneypotConfig;
  private jupiterSimulator: JupiterSimulator | null = null;
  private permanentBlacklist: Set<string> = new Set();

  constructor(tier: StrategyTier, jupiterSimulator?: JupiterSimulator) {
    this.config = getTierConfig(tier).honeypot;
    if (jupiterSimulator) {
      this.jupiterSimulator = jupiterSimulator;
    }
  }

  setJupiterSimulator(simulator: JupiterSimulator): void {
    this.jupiterSimulator = simulator;
  }

  async fullCheck(
    tokenMint: string,
    mintData: TokenMintData,
    recentSells: SellTransaction[],
    safetyData: Partial<SafetyData>,
  ): Promise<HoneypotCheckResult> {
    const result: HoneypotCheckResult = {
      passed: true,
      reason: 'All honeypot checks passed',
      buySimSuccess: false,
      sellSimSuccess: false,
      estimatedBuyTax: 0,
      estimatedSellTax: 0,
      freezeAuthorityRisk: false,
      mintAuthorityRisk: false,
      sellFailureRate: 0,
    };

    if (this.permanentBlacklist.has(tokenMint)) {
      return {
        ...result,
        passed: false,
        reason: 'Token permanently blacklisted from previous honeypot detection',
      };
    }

    const simResult = await this.runSimulation(tokenMint, result);
    if (!simResult.passed) {
      this.permanentBlacklist.add(tokenMint);
      return simResult;
    }

    const taxResult = this.checkTransferTax(safetyData, result);
    if (!taxResult.passed) {
      return taxResult;
    }

    const authorityResult = this.checkAuthorities(mintData, result);
    if (!authorityResult.passed) {
      this.permanentBlacklist.add(tokenMint);
      return authorityResult;
    }

    const sellHistoryResult = this.checkSellHistory(recentSells, result);
    if (!sellHistoryResult.passed) {
      this.permanentBlacklist.add(tokenMint);
      return sellHistoryResult;
    }

    logger.info('HoneypotChecker: all checks passed', { tokenMint });
    return result;
  }

  private async runSimulation(
    tokenMint: string,
    baseResult: HoneypotCheckResult,
  ): Promise<HoneypotCheckResult> {
    if (!this.jupiterSimulator) {
      logger.warn('HoneypotChecker: no Jupiter simulator available — skipping simulation');
      return { ...baseResult, buySimSuccess: true, sellSimSuccess: true };
    }

    if (process.env.DRY_RUN === 'true' || process.env.BOT_DRY_RUN === 'true') {
      logger.debug('HoneypotChecker: DRY_RUN — skipping Jupiter simulation', { tokenMint: tokenMint.slice(0, 8) });
      return { ...baseResult, buySimSuccess: true, sellSimSuccess: true };
    }

    try {
      const simBuy = await this.jupiterSimulator.simulateSwap({
        inputMint: SOL_MINT,
        outputMint: tokenMint,
        amount: this.config.simBuyAmountSol,
      });

      if (!simBuy.success) {
        return {
          ...baseResult,
          passed: false,
          reason: 'HONEYPOT: buy simulation failed',
          buySimSuccess: false,
        };
      }
      baseResult.buySimSuccess = true;

      const simSell = await this.jupiterSimulator.simulateSwap({
        inputMint: tokenMint,
        outputMint: SOL_MINT,
        amount: simBuy.outputAmount,
      });

      if (!simSell.success) {
        return {
          ...baseResult,
          passed: false,
          reason: 'HONEYPOT: sell simulation blocked — cannot exit position',
          sellSimSuccess: false,
        };
      }
      baseResult.sellSimSuccess = true;

      const simTaxFloor = 1 - (parseFloat(process.env.HONEYPOT_TAX_REJECT_PERCENT ?? '30') / 100);
      if (simSell.outputAmount < simBuy.inputAmount * simTaxFloor) {
        const taxEstimate = ((simBuy.inputAmount - simSell.outputAmount) / simBuy.inputAmount) * 100;
        return {
          ...baseResult,
          passed: false,
          reason: `HONEYPOT: extreme sell tax ~${taxEstimate.toFixed(1)}% — sell returns < ${((1 - simTaxFloor) * 100).toFixed(0)}% of input`,
          estimatedSellTax: taxEstimate,
        };
      }

      const buyTax = simBuy.inputAmount > 0
        ? Math.max(0, 1 - (simBuy.outputAmount * (simSell.outputAmount / simSell.inputAmount)) / simBuy.inputAmount) * 100
        : 0;
      const sellTax = simBuy.outputAmount > 0
        ? Math.max(0, 1 - simSell.outputAmount / (simBuy.outputAmount * (simBuy.inputAmount / simBuy.outputAmount))) * 100
        : 0;

      baseResult.estimatedBuyTax = buyTax;
      baseResult.estimatedSellTax = sellTax;

      const honeypotTaxThreshold = parseFloat(process.env.HONEYPOT_TAX_REJECT_PERCENT ?? '30');
      if (buyTax > honeypotTaxThreshold || sellTax > honeypotTaxThreshold) {
        return {
          ...baseResult,
          passed: false,
          reason: `HONEYPOT: extreme tax detected — buy ${buyTax.toFixed(1)}%, sell ${sellTax.toFixed(1)}% (threshold ${honeypotTaxThreshold}%)`,
        };
      }

      logger.debug('HoneypotChecker: simulation passed', {
        tokenMint,
        buyTax: buyTax.toFixed(2),
        sellTax: sellTax.toFixed(2),
      });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('HoneypotChecker: simulation error', { tokenMint, error: errorMsg });
      return {
        ...baseResult,
        passed: false,
        reason: `Simulation error: ${errorMsg}`,
      };
    }

    return baseResult;
  }

  private checkTransferTax(
    safetyData: Partial<SafetyData>,
    baseResult: HoneypotCheckResult,
  ): HoneypotCheckResult {
    const buyTax = safetyData.buyTaxPercent ?? 0;
    const sellTax = safetyData.sellTaxPercent ?? 0;

    const transferTaxThreshold = parseFloat(process.env.HONEYPOT_TAX_REJECT_PERCENT ?? '30');
    if (buyTax > transferTaxThreshold || sellTax > transferTaxThreshold) {
      return {
        ...baseResult,
        passed: false,
        reason: `REJECT: tax > ${transferTaxThreshold}% — buy ${buyTax}%, sell ${sellTax}%`,
        estimatedBuyTax: buyTax,
        estimatedSellTax: sellTax,
      };
    }

    if (sellTax > this.config.rejectTaxPercent) {
      return {
        ...baseResult,
        passed: false,
        reason: `REJECT: sell tax ${sellTax}% > ${this.config.rejectTaxPercent}% max`,
        estimatedSellTax: sellTax,
      };
    }

    if (buyTax > this.config.maxBuyTaxPercent) {
      logger.warn('HoneypotChecker: high buy tax flagged', { buyTax });
      baseResult.estimatedBuyTax = buyTax;
    }

    if (sellTax > this.config.maxSellTaxPercent) {
      logger.warn('HoneypotChecker: high sell tax flagged', { sellTax });
      baseResult.estimatedSellTax = sellTax;
    }

    if (buyTax !== sellTax && Math.abs(buyTax - sellTax) > 3) {
      logger.warn('HoneypotChecker: asymmetric tax detected — suspicious', {
        buyTax,
        sellTax,
      });
    }

    return baseResult;
  }

  private checkAuthorities(
    mintData: TokenMintData,
    baseResult: HoneypotCheckResult,
  ): HoneypotCheckResult {
    if (mintData.freezeAuthority !== null) {
      const isKnownSafe = this.config.knownSafePrograms.includes(mintData.freezeAuthority);
      if (!isKnownSafe) {
        return {
          ...baseResult,
          passed: false,
          reason: `REJECT: unknown freeze authority ${mintData.freezeAuthority.slice(0, 8)}… — token can be frozen`,
          freezeAuthorityRisk: true,
        };
      }
    }

    if (mintData.mintAuthority !== null) {
      const isKnownSafe = this.config.knownSafePrograms.includes(mintData.mintAuthority);
      if (!isKnownSafe) {
        return {
          ...baseResult,
          passed: false,
          reason: `REJECT: active mint authority ${mintData.mintAuthority.slice(0, 8)}… — infinite supply risk`,
          mintAuthorityRisk: true,
        };
      }
    }

    return baseResult;
  }

  private checkSellHistory(
    recentSells: SellTransaction[],
    baseResult: HoneypotCheckResult,
  ): HoneypotCheckResult {
    if (recentSells.length === 0) {
      return baseResult;
    }

    const last20 = recentSells.slice(-20);
    const failures = last20.filter(s => !s.success);
    const failureRate = (failures.length / last20.length) * 100;

    if (failureRate > this.config.maxSellFailureRate) {
      return {
        ...baseResult,
        passed: false,
        reason: `HONEYPOT: sell tx failure rate ${failureRate.toFixed(0)}% > ${this.config.maxSellFailureRate}%`,
        sellFailureRate: failureRate,
      };
    }
    baseResult.sellFailureRate = failureRate;

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recentSuccessfulSells = last20.filter(s => s.success && s.timestamp > fiveMinAgo);
    if (recentSuccessfulSells.length > 0) {
      const uniqueSellers = new Set(recentSuccessfulSells.map(s => s.wallet));
      if (uniqueSellers.size === 1 && recentSuccessfulSells.length > 3) {
        logger.warn('HoneypotChecker: all recent sells from single wallet — likely wash', {
          wallet: recentSuccessfulSells[0].wallet.slice(0, 8),
        });
      }
    }

    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const successfulSellsIn10min = recentSells.filter(
      s => s.success && s.timestamp > tenMinAgo,
    );
    if (successfulSellsIn10min.length === 0 && recentSells.some(s => s.timestamp > tenMinAgo)) {
      return {
        ...baseResult,
        passed: false,
        reason: 'HONEYPOT: no successful sells in first 10 minutes despite attempts',
        sellFailureRate: 100,
      };
    }

    return baseResult;
  }

  isBlacklisted(tokenMint: string): boolean {
    return this.permanentBlacklist.has(tokenMint);
  }

  addToBlacklist(tokenMint: string): void {
    this.permanentBlacklist.add(tokenMint);
  }
}
