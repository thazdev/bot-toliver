// UPDATED: Max slippage entry 35% -> 25% - 2026-03-07
import { BaseStrategy } from './BaseStrategy.js';
import { getTierConfig, type TierConfig } from './config.js';
import { logger } from '../utils/logger.js';
import type {
  StrategyContext,
  StrategyResult,
  EntryScoreBreakdown,
  EntryTriggerType,
  StrategyTier,
} from '../types/strategy.types.js';

export class EntryStrategy extends BaseStrategy {
  readonly name = 'EntryStrategy';
  readonly description = 'Multi-mode entry with signal stacking, scoring, and anti-FOMO';
  readonly version = '1.0.0';

  private tier: StrategyTier;
  private tierConfig: TierConfig;

  constructor(tier: StrategyTier) {
    super();
    this.tier = tier;
    this.tierConfig = getTierConfig(tier);
  }

  async evaluate(context: StrategyContext): Promise<StrategyResult> {
    const skip = (reason: string): StrategyResult => ({
      signal: 'skip',
      confidence: 0,
      reason,
      suggestedSizeSol: 0,
    });

    if (!this.passesSignalStack(context)) {
      return skip('Failed signal stack pre-conditions');
    }

    if (this.isAntifomoTriggered(context)) {
      return skip(`Anti-FOMO gate: price already up ${context.priceChangeFromLaunch.toFixed(0)}% from launch`);
    }

    const entryScore = this.calculateEntryScore(context);
    if (entryScore.totalScore < this.tierConfig.entry.minEntryScore) {
      return skip(`Entry score ${entryScore.totalScore.toFixed(1)} below threshold ${this.tierConfig.entry.minEntryScore}`);
    }

    const triggerType = this.determineTriggerType(context);
    if (!triggerType) {
      return skip('No entry trigger type matched');
    }

    const triggerResult = this.evaluateTrigger(triggerType, context);
    if (!triggerResult.pass) {
      return skip(`Trigger ${triggerType} failed: ${triggerResult.reason}`);
    }

    const confidence = entryScore.totalScore / 100;
    const sizeSol = this.calculateSuggestedSize(context, confidence, triggerType);

    if (sizeSol <= 0) {
      return skip('Calculated position size is zero');
    }

    const maxSlippageEntry = parseFloat(process.env.MAX_SLIPPAGE_ENTRY_PERCENT ?? '25') / 100;
    const slippageLoss = this.estimateSlippageLoss(sizeSol, context.liquidity);
    if (slippageLoss > maxSlippageEntry) {
      return skip(`Expected slippage loss ${(slippageLoss * 100).toFixed(1)}% exceeds ${(maxSlippageEntry * 100).toFixed(0)}% max — illiquid stop risk`);
    }

    logger.debug('EntryStrategy: BUY signal generated', {
      token: context.tokenInfo.mintAddress,
      trigger: triggerType,
      score: entryScore.totalScore.toFixed(1),
      sizeSol: sizeSol.toFixed(4),
      tier: this.tier,
    });

    return {
      signal: 'buy',
      confidence,
      reason: `${triggerType} entry — score ${entryScore.totalScore.toFixed(1)}/100`,
      suggestedSizeSol: sizeSol,
      triggerType,
      entryScore,
    };
  }

  private passesSignalStack(ctx: StrategyContext): boolean {
    const cfg = this.tierConfig.entry;
    const tokenMint = ctx.tokenInfo.mintAddress.slice(0, 12);
    const minLiq = parseFloat(process.env.MIN_LIQUIDITY_FOR_SIGNAL ?? '0.5') || 0.5;
    const minBuys = parseInt(process.env.MIN_BUYS_LAST_60S ?? '1', 10) || 1;

    if (ctx.liquidity < minLiq) {
      logger.debug('SIGNAL_STACK_FAIL', {
        tokenMint,
        failedCondition: 'liquidity',
        value: ctx.liquidity,
        required: minLiq,
      });
      return false;
    }

    if (ctx.holderData.holderCount < cfg.minHolderCount) {
      logger.debug('SIGNAL_STACK_FAIL', {
        tokenMint,
        failedCondition: 'holderCount',
        value: ctx.holderData.holderCount,
        required: cfg.minHolderCount,
      });
      return false;
    }

    if (ctx.holderData.topHolderPercent > cfg.maxTopHolderPercent) {
      logger.debug('SIGNAL_STACK_FAIL', {
        tokenMint,
        failedCondition: 'topHolderPercent',
        value: ctx.holderData.topHolderPercent,
        required: cfg.maxTopHolderPercent,
      });
      return false;
    }

    if (ctx.holderData.top5HolderPercent > cfg.maxTop5HolderPercent) {
      logger.debug('SIGNAL_STACK_FAIL', {
        tokenMint,
        failedCondition: 'top5HolderPercent',
        value: ctx.holderData.top5HolderPercent,
        required: cfg.maxTop5HolderPercent,
      });
      return false;
    }

    if (!ctx.safetyData.mintAuthorityDisabled) {
      logger.debug('SIGNAL_STACK_FAIL', {
        tokenMint,
        failedCondition: 'mintAuthorityDisabled',
        value: false,
        required: true,
      });
      return false;
    }

    if (!ctx.safetyData.freezeAuthorityAbsent) {
      logger.debug('SIGNAL_STACK_FAIL', {
        tokenMint,
        failedCondition: 'freezeAuthorityAbsent',
        value: false,
        required: true,
      });
      return false;
    }

    if (ctx.volumeContext.buyTxLast60s < minBuys) {
      logger.debug('SIGNAL_STACK_FAIL', {
        tokenMint,
        failedCondition: 'buyTxLast60s',
        value: ctx.volumeContext.buyTxLast60s,
        required: minBuys,
      });
      return false;
    }

    if (ctx.safetyData.isBlacklisted) {
      logger.debug('SIGNAL_STACK_FAIL', {
        tokenMint,
        failedCondition: 'isBlacklisted',
        value: true,
        required: false,
      });
      return false;
    }

    if (ctx.safetyData.rugScore < 70) {
      logger.debug('SIGNAL_STACK_FAIL', {
        tokenMint,
        failedCondition: 'rugScore',
        value: ctx.safetyData.rugScore,
        required: 70,
      });
      return false;
    }

    return true;
  }

  private isAntifomoTriggered(ctx: StrategyContext): boolean {
    const maxGain = this.tierConfig.entry.maxPriceGainFromLaunch;

    if (ctx.priceChangeFromLaunch > maxGain) {
      if (!ctx.smartMoneyData.smartMoneyHolding) {
        return true;
      }
      if (ctx.volumeContext.volume1min <= ctx.volumeContext.volume5minAvg) {
        return true;
      }
    }

    if (ctx.volumeContext.sellTxLast20 > ctx.volumeContext.buyTxLast20) {
      logger.debug('EntryStrategy: sell pressure exceeds buy pressure in last 20 txns');
      return true;
    }

    return false;
  }

  calculateEntryScore(ctx: StrategyContext): EntryScoreBreakdown {
    const liquidityScore = this.scoreLiquidity(ctx);
    const holderScore = this.scoreHolders(ctx);
    const momentumScore = this.scoreMomentum(ctx);
    const safetyScore = this.scoreSafety(ctx);
    const smartMoneyScore = this.scoreSmartMoney(ctx);

    const totalScore =
      liquidityScore * 0.25 +
      holderScore * 0.20 +
      momentumScore * 0.20 +
      safetyScore * 0.25 +
      smartMoneyScore * 0.10;

    return {
      liquidityScore,
      holderScore,
      momentumScore,
      safetyScore,
      smartMoneyScore,
      totalScore,
    };
  }

  private scoreLiquidity(ctx: StrategyContext): number {
    const sol = ctx.liquidity;
    if (sol <= 0) return 0;
    if (sol >= 50) return 100;
    if (sol >= 20) return 80 + ((sol - 20) / 30) * 20;
    if (sol >= 10) return 60 + ((sol - 10) / 10) * 20;
    if (sol >= 5) return 40 + ((sol - 5) / 5) * 20;
    if (sol >= 1) return 10 + ((sol - 1) / 4) * 30;
    return sol * 10;
  }

  private scoreHolders(ctx: StrategyContext): number {
    const { holderCount, topHolderPercent, top5HolderPercent, holderGrowthRate } = ctx.holderData;

    let score = 0;

    if (holderCount >= 100) score += 40;
    else if (holderCount >= 50) score += 30;
    else if (holderCount >= 20) score += 20;
    else if (holderCount >= 10) score += 10;
    else score += holderCount;

    const concentrationPenalty = Math.max(0, topHolderPercent - 10) * 1.5 +
                                  Math.max(0, top5HolderPercent - 30) * 0.5;
    score = Math.max(0, score - concentrationPenalty);

    if (holderGrowthRate >= 5) score += 30;
    else if (holderGrowthRate >= 2) score += 20;
    else if (holderGrowthRate >= 1) score += 10;

    return Math.min(100, score);
  }

  private scoreMomentum(ctx: StrategyContext): number {
    let score = 0;

    const volumeRatio = ctx.volumeContext.volume5minAvg > 0
      ? ctx.volumeContext.volume1min / ctx.volumeContext.volume5minAvg
      : 0;
    if (volumeRatio >= 3) score += 40;
    else if (volumeRatio >= 2) score += 30;
    else if (volumeRatio >= 1.5) score += 20;
    else if (volumeRatio >= 1) score += 10;

    if (ctx.priceChangePercent5min >= 30) score += 30;
    else if (ctx.priceChangePercent5min >= 15) score += 20;
    else if (ctx.priceChangePercent5min >= 5) score += 10;

    if (ctx.volumeContext.buyTxLast60s >= 10) score += 30;
    else if (ctx.volumeContext.buyTxLast60s >= 5) score += 20;
    else if (ctx.volumeContext.buyTxLast60s >= 2) score += 10;

    return Math.min(100, score);
  }

  private scoreSafety(ctx: StrategyContext): number {
    let score = ctx.safetyData.rugScore;

    if (ctx.safetyData.mintAuthorityDisabled) score += 0;
    else score -= 30;

    if (ctx.safetyData.freezeAuthorityAbsent) score += 0;
    else score -= 20;

    if (ctx.safetyData.isBlacklisted) score -= 50;
    if (ctx.safetyData.devWalletSelling) score -= 30;

    return Math.max(0, Math.min(100, score));
  }

  private scoreSmartMoney(ctx: StrategyContext): number {
    return Math.max(0, Math.min(100, ctx.smartMoneyData.smartMoneyScore));
  }

  private determineTriggerType(ctx: StrategyContext): EntryTriggerType | null {
    if (ctx.tokenAgeSec < 60 && ctx.liquidity > 0) {
      return 'new_token_sniper';
    }

    if (ctx.tokenAgeSec < 600 && ctx.poolInitialSol >= this.tierConfig.entry.minLiquiditySol) {
      return 'pool_creation_sniper';
    }

    if (ctx.previouslyTraded && ctx.priceDropFromPeak >= 40 && ctx.priceDropFromPeak <= 70) {
      return 'dip_reentry';
    }

    if (ctx.tokenAgeSec >= 60 && ctx.tokenAgeSec <= 1800) {
      return 'momentum_confirmation';
    }

    return null;
  }

  private evaluateTrigger(
    trigger: EntryTriggerType,
    ctx: StrategyContext,
  ): { pass: boolean; reason: string } {
    switch (trigger) {
      case 'new_token_sniper':
        return this.evaluateTypeA(ctx);
      case 'pool_creation_sniper':
        return this.evaluateTypeB(ctx);
      case 'momentum_confirmation':
        return this.evaluateTypeC(ctx);
      case 'dip_reentry':
        return this.evaluateTypeD(ctx);
    }
  }

  private evaluateTypeA(ctx: StrategyContext): { pass: boolean; reason: string } {
    if (ctx.tokenAgeSec >= 60) {
      return { pass: false, reason: 'Token age >= 60s for sniper mode' };
    }
    if (ctx.liquidity <= 0) {
      return { pass: false, reason: 'No liquidity added yet' };
    }
    if (ctx.safetyData.rugScore < 70) {
      return { pass: false, reason: `Rug score ${ctx.safetyData.rugScore} < 70` };
    }
    if (ctx.holderData.topHolderPercent >= 20) {
      return { pass: false, reason: `Top holder ${ctx.holderData.topHolderPercent}% >= 20%` };
    }
    return { pass: true, reason: 'Type A sniper conditions met' };
  }

  private evaluateTypeB(ctx: StrategyContext): { pass: boolean; reason: string } {
    const minPoolSol = this.tierConfig.launch.phase1MinPoolSol;
    if (ctx.poolInitialSol < minPoolSol) {
      return { pass: false, reason: `Pool initial SOL ${ctx.poolInitialSol} < ${minPoolSol}` };
    }
    if (ctx.safetyData.isBlacklisted) {
      return { pass: false, reason: 'Token is blacklisted' };
    }
    const minHolders = this.tierConfig.entry.minHolderCount;
    if (ctx.holderData.holderCount < minHolders) {
      return { pass: false, reason: `Holder count ${ctx.holderData.holderCount} < ${minHolders}` };
    }
    return { pass: true, reason: 'Type B pool creation conditions met' };
  }

  private evaluateTypeC(ctx: StrategyContext): { pass: boolean; reason: string } {
    const volumeRatio = ctx.volumeContext.volume5minAvg > 0
      ? ctx.volumeContext.volume1min / ctx.volumeContext.volume5minAvg
      : 0;

    if (volumeRatio < 3) {
      return { pass: false, reason: `Volume ratio ${volumeRatio.toFixed(1)} < 3x threshold` };
    }
    if (ctx.priceChangePercent5min < 15) {
      return { pass: false, reason: `5min price change ${ctx.priceChangePercent5min.toFixed(1)}% < 15%` };
    }
    if (ctx.holderData.holderGrowthRate < 2) {
      return { pass: false, reason: `Holder growth ${ctx.holderData.holderGrowthRate.toFixed(1)}/min < 2/min` };
    }
    if (ctx.liquidityUsd < 5000) {
      return { pass: false, reason: `Liquidity $${ctx.liquidityUsd.toFixed(0)} < $5,000` };
    }
    return { pass: true, reason: 'Type C momentum confirmation conditions met' };
  }

  private evaluateTypeD(ctx: StrategyContext): { pass: boolean; reason: string } {
    if (!ctx.previouslyTraded) {
      return { pass: false, reason: 'Not previously traded' };
    }
    if (ctx.priceDropFromPeak < 40 || ctx.priceDropFromPeak > 70) {
      return { pass: false, reason: `Price drop ${ctx.priceDropFromPeak.toFixed(1)}% not in 40–70% range` };
    }
    if (!ctx.volumeContext.volumeStillActive) {
      return { pass: false, reason: 'Volume no longer active' };
    }
    if (ctx.holderData.holdersDecreasing) {
      return { pass: false, reason: 'Holder count is decreasing' };
    }
    return { pass: true, reason: 'Type D dip re-entry conditions met' };
  }

  private calculateSuggestedSize(
    ctx: StrategyContext,
    confidence: number,
    triggerType: EntryTriggerType,
  ): number {
    const cfg = this.tierConfig.entry;
    const basePercent = cfg.maxPositionPercent / 100;
    let sizeSol = ctx.liquidity * basePercent;

    sizeSol *= confidence;

    sizeSol = Math.max(cfg.solSizeMin, Math.min(cfg.solSizeMax, sizeSol));

    if (triggerType === 'dip_reentry') {
      sizeSol *= 0.5;
    }

    if (triggerType === 'new_token_sniper') {
      sizeSol = Math.min(sizeSol, cfg.solSizeMax);
    }

    return Math.round(sizeSol * 1_000_000_000) / 1_000_000_000;
  }

  private estimateSlippageLoss(positionSol: number, poolLiquiditySol: number): number {
    if (poolLiquiditySol <= 0) return 1;
    return (positionSol / poolLiquiditySol) * 1.5;
  }
}
