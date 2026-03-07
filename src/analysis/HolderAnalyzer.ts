import { logger } from '../utils/logger.js';
import { getTierConfig, type HolderConfig, type TierConfig } from '../strategies/config.js';
import type { StrategyTier } from '../types/strategy.types.js';

export interface HolderAssessment {
  holderHealthScore: number;
  diversityScore: number;
  growthScore: number;
  whaleRiskScore: number;
  entryScoreAdjustment: number;
  sizeMultiplier: number;
  reject: boolean;
  rejectReason: string | null;
  warnings: string[];
}

export interface HolderInput {
  holderCount: number;
  topHolderPercent: number;
  top5HolderPercent: number;
  giniCoefficient: number;
  newHoldersPerMinute: number;
  tokenAgeSec: number;
  sybilFundedPercent: number;
  holdersDecreasing: boolean;
  top10Holders: TopHolderInfo[];
}

export interface TopHolderInfo {
  address: string;
  balancePercent: number;
  previousBalancePercent: number;
}

export interface TopHolderAlert {
  address: string;
  type: 'selling' | 'accumulating';
  changePercent: number;
}

export class HolderAnalyzer {
  private tier: StrategyTier;
  private tierConfig: TierConfig;
  private holderConfig: HolderConfig;

  constructor(tier: StrategyTier) {
    this.tier = tier;
    this.tierConfig = getTierConfig(tier);
    this.holderConfig = this.tierConfig.holder;
  }

  analyze(input: HolderInput): HolderAssessment {
    const warnings: string[] = [];
    let entryScoreAdjustment = 0;
    let sizeMultiplier = 1.0;

    const rejectionCheck = this.checkRejections(input);
    if (rejectionCheck.reject) {
      return {
        holderHealthScore: 0,
        diversityScore: 0,
        growthScore: 0,
        whaleRiskScore: 0,
        entryScoreAdjustment: 0,
        sizeMultiplier: 0,
        reject: true,
        rejectReason: rejectionCheck.reason,
        warnings: [],
      };
    }

    const diversityScore = this.calculateDiversityScore(input.giniCoefficient);
    const growthScore = this.calculateGrowthScore(input.newHoldersPerMinute);
    const whaleRiskScore = this.calculateWhaleRiskScore(input.top5HolderPercent);

    const holderHealthScore =
      diversityScore * 0.35 +
      growthScore * 0.35 +
      whaleRiskScore * 0.30;

    const cfg = this.holderConfig;

    if (input.holderCount < cfg.highRiskMaxHolders) {
      if (this.tier !== 'aggressive') {
        warnings.push(`Only ${input.holderCount} holders — high risk, aggressive tier only`);
      }
      sizeMultiplier = cfg.highRiskSizeMultiplier;
    } else if (input.holderCount >= cfg.strongSignalMinHolders) {
      warnings.push(`${input.holderCount} holders — strong social signal`);
    }

    const velocity = input.newHoldersPerMinute;

    if (velocity >= cfg.viralVelocityThreshold) {
      entryScoreAdjustment += cfg.viralScoreBoost;
      warnings.push(`Viral holder velocity: ${velocity.toFixed(1)}/min (+${cfg.viralScoreBoost} score)`);
    } else if (velocity >= cfg.strongLaunchVelocity && input.tokenAgeSec < 300) {
      entryScoreAdjustment += cfg.strongLaunchScoreBoost;
      warnings.push(`Strong launch velocity: ${velocity.toFixed(1)}/min (+${cfg.strongLaunchScoreBoost} score)`);
    } else if (velocity < cfg.staleVelocityThreshold && input.tokenAgeSec > 600) {
      entryScoreAdjustment -= cfg.staleScorePenalty;
      warnings.push(`Stale token: ${velocity.toFixed(1)} holders/min (-${cfg.staleScorePenalty} score)`);
    }

    if (input.holdersDecreasing) {
      warnings.push('Holder count declining — exit signal');
      sizeMultiplier = Math.min(sizeMultiplier, 0.5);
    }

    logger.debug('HolderAnalyzer: assessment', {
      holderCount: input.holderCount,
      healthScore: holderHealthScore.toFixed(1),
      diversity: diversityScore.toFixed(1),
      growth: growthScore.toFixed(1),
      whaleRisk: whaleRiskScore.toFixed(1),
      adjustment: entryScoreAdjustment,
      sizeMultiplier,
    });

    return {
      holderHealthScore,
      diversityScore,
      growthScore,
      whaleRiskScore,
      entryScoreAdjustment,
      sizeMultiplier,
      reject: false,
      rejectReason: null,
      warnings,
    };
  }

  checkTopHolderActivity(holders: TopHolderInfo[]): TopHolderAlert[] {
    const alerts: TopHolderAlert[] = [];

    for (const holder of holders) {
      if (holder.previousBalancePercent <= 0) continue;

      const changePercent = ((holder.balancePercent - holder.previousBalancePercent) / holder.previousBalancePercent) * 100;

      if (changePercent <= -10) {
        alerts.push({
          address: holder.address,
          type: 'selling',
          changePercent,
        });
        logger.warn('HolderAnalyzer: top holder selling', {
          address: holder.address.slice(0, 8),
          changePercent: changePercent.toFixed(1),
          currentPercent: holder.balancePercent.toFixed(2),
        });
      } else if (changePercent >= 20) {
        alerts.push({
          address: holder.address,
          type: 'accumulating',
          changePercent,
        });
      }
    }

    return alerts;
  }

  private checkRejections(input: HolderInput): { reject: boolean; reason: string | null } {
    const cfg = this.holderConfig;

    if (input.holderCount < cfg.rejectBelowHolders) {
      return { reject: true, reason: `Only ${input.holderCount} holders < ${cfg.rejectBelowHolders} minimum — no organic demand` };
    }

    if (input.topHolderPercent > cfg.topHolderRejectPercent) {
      return { reject: true, reason: `Top holder ${input.topHolderPercent.toFixed(1)}% > ${cfg.topHolderRejectPercent}% — extreme concentration` };
    }

    if (input.top5HolderPercent > cfg.top5RejectPercent) {
      return { reject: true, reason: `Top 5 hold ${input.top5HolderPercent.toFixed(1)}% > ${cfg.top5RejectPercent}% — cartel pattern` };
    }

    if (input.sybilFundedPercent >= cfg.sybilFundedPercentThreshold) {
      return { reject: true, reason: `${input.sybilFundedPercent.toFixed(0)}% of new holders funded from same wallet — sybil attack` };
    }

    return { reject: false, reason: null };
  }

  private calculateDiversityScore(giniCoefficient: number): number {
    return Math.max(0, Math.min(100, (1 - giniCoefficient) * 100));
  }

  private calculateGrowthScore(newHoldersPerMinute: number): number {
    return Math.max(0, Math.min(100, newHoldersPerMinute * 10));
  }

  private calculateWhaleRiskScore(top5HolderPercent: number): number {
    return Math.max(0, Math.min(100, 100 - top5HolderPercent * 2));
  }
}
