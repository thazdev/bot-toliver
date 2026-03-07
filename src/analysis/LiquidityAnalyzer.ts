import { logger } from '../utils/logger.js';
import { getTierConfig, type LiquidityConfig, type TierConfig } from '../strategies/config.js';
import type { StrategyTier } from '../types/strategy.types.js';

export interface LiquidityAssessment {
  liquidityScore: number;
  poolSolScore: number;
  depthScore: number;
  stabilityScore: number;
  priceImpactPercent: number;
  maxSafePositionSol: number;
  passesMinThresholds: boolean;
  rejectReason: string | null;
}

export interface LiquidityInput {
  poolSol: number;
  poolUsd: number;
  poolAgeSec: number;
  bidDepth2pct: number;
  liquidityStdDev10min: number;
  avgLiquidity10min: number;
  positionSizeSol: number;
}

export class LiquidityAnalyzer {
  private tier: StrategyTier;
  private tierConfig: TierConfig;
  private liqConfig: LiquidityConfig;

  constructor(tier: StrategyTier) {
    this.tier = tier;
    this.tierConfig = getTierConfig(tier);
    this.liqConfig = this.tierConfig.liquidity;
  }

  analyze(input: LiquidityInput): LiquidityAssessment {
    const poolSolScore = this.scorePoolSol(input.poolSol);
    const depthScore = this.scoreDepth(input.bidDepth2pct, input.positionSizeSol);
    const stabilityScore = this.scoreStability(input.liquidityStdDev10min, input.avgLiquidity10min);

    const liquidityScore =
      poolSolScore * 0.40 +
      depthScore * 0.30 +
      stabilityScore * 0.30;

    const priceImpactPercent = this.estimatePriceImpact(input.positionSizeSol, input.poolSol);
    const maxSafePositionSol = this.calculateMaxSafePosition(input.poolSol);

    const thresholdCheck = this.checkMinThresholds(input, liquidityScore, priceImpactPercent);

    logger.debug('LiquidityAnalyzer: assessment', {
      poolSol: input.poolSol,
      liquidityScore: liquidityScore.toFixed(1),
      priceImpact: priceImpactPercent.toFixed(2) + '%',
      maxSafe: maxSafePositionSol.toFixed(4),
      passes: thresholdCheck.passes,
    });

    return {
      liquidityScore,
      poolSolScore,
      depthScore,
      stabilityScore,
      priceImpactPercent,
      maxSafePositionSol,
      passesMinThresholds: thresholdCheck.passes,
      rejectReason: thresholdCheck.reason,
    };
  }

  private scorePoolSol(poolSol: number): number {
    if (poolSol <= 0) return 0;
    if (poolSol < 1) return 0;
    if (poolSol < 5) return 20;
    if (poolSol < 20) return 50;
    if (poolSol < 100) return 80;
    return 100;
  }

  private scoreDepth(bidDepth2pct: number, positionSize: number): number {
    if (positionSize <= 0) return 50;
    const ratio = (bidDepth2pct / positionSize) * 100;
    return Math.max(0, Math.min(100, ratio));
  }

  private scoreStability(stdDev: number, avgLiquidity: number): number {
    if (avgLiquidity <= 0) return 0;
    const volatilityPct = (stdDev / avgLiquidity) * 100;
    return Math.max(0, 100 - volatilityPct);
  }

  estimatePriceImpact(positionSizeSol: number, poolSolReserve: number): number {
    if (poolSolReserve <= 0) return 100;
    return (positionSizeSol / poolSolReserve) * 100 * this.liqConfig.impactMultiplier;
  }

  calculateMaxSafePosition(poolSol: number): number {
    if (poolSol <= 0) return 0;
    return (poolSol * (this.liqConfig.maxImpactPercent / 100)) / this.liqConfig.impactMultiplier;
  }

  capPositionToPoolDepth(desiredSizeSol: number, poolSol: number): number {
    const maxSafe = this.calculateMaxSafePosition(poolSol);
    if (desiredSizeSol <= maxSafe) return desiredSizeSol;

    logger.debug('LiquidityAnalyzer: capping position size to pool depth', {
      desired: desiredSizeSol.toFixed(4),
      maxSafe: maxSafe.toFixed(4),
      poolSol,
    });

    return maxSafe;
  }

  private checkMinThresholds(
    input: LiquidityInput,
    liquidityScore: number,
    priceImpactPercent: number,
  ): { passes: boolean; reason: string | null } {
    if (input.poolSol < this.liqConfig.minPoolSol) {
      return {
        passes: false,
        reason: `Pool SOL ${input.poolSol.toFixed(2)} < min ${this.liqConfig.minPoolSol}`,
      };
    }

    if (input.poolUsd < this.liqConfig.minPoolUsd) {
      return {
        passes: false,
        reason: `Pool USD $${input.poolUsd.toFixed(0)} < min $${this.liqConfig.minPoolUsd}`,
      };
    }

    if (priceImpactPercent > this.liqConfig.maxImpactPercent) {
      return {
        passes: false,
        reason: `Price impact ${priceImpactPercent.toFixed(2)}% > max ${this.liqConfig.maxImpactPercent}%`,
      };
    }

    if (liquidityScore < this.liqConfig.minLiquidityScore) {
      return {
        passes: false,
        reason: `Liquidity score ${liquidityScore.toFixed(1)} < min ${this.liqConfig.minLiquidityScore}`,
      };
    }

    if (input.poolAgeSec < this.liqConfig.minLiquidityAgeSec) {
      return {
        passes: false,
        reason: `Pool age ${input.poolAgeSec}s < min ${this.liqConfig.minLiquidityAgeSec}s`,
      };
    }

    return { passes: true, reason: null };
  }
}
