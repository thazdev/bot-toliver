// UPDATED: Disable Type A sniper, tighten signal stack, add buy/sell ratio gates - 2026-03-09
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

    const signalStackResult = this.checkSignalStack(context);
    if (!signalStackResult.passed) {
      const failReasons = signalStackResult.failedConditions.join(', ');
      return skip(`Failed signal stack pre-conditions: [${failReasons}]`);
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

  /**
   * Executa Signal Stack check — usado no pipeline antes de EMAS e TradeFilterPipeline.
   */
  static runSignalStackCheck(
    ctx: StrategyContext,
    tier: StrategyTier,
  ): { passed: boolean; failedConditions: string[] } {
    const cfg = getTierConfig(tier).entry;
    return EntryStrategy.runSignalStackCheckInternal(ctx, cfg);
  }

  /**
   * Retorna { passed, failedConditions } para debug — condições falhadas aparecem em skipReasons.
   */
  private checkSignalStack(ctx: StrategyContext): { passed: boolean; failedConditions: string[] } {
    return EntryStrategy.runSignalStackCheckInternal(ctx, this.tierConfig.entry);
  }

  private static runSignalStackCheckInternal(
    ctx: StrategyContext,
    cfg: import('./config.js').EntryConfig,
  ): { passed: boolean; failedConditions: string[] } {
    const tokenMint = ctx.tokenInfo.mintAddress.slice(0, 12);
    const failed: string[] = [];

    logger.debug('SIGNAL_STACK_CHECK', {
      tokenMint,
      liquidity: ctx.liquidity,
      minLiq: cfg.minLiquiditySol,
      poolAgeSec: ctx.poolAgeSec,
      minPoolAgeSec: cfg.minPoolAgeSec,
      holderCount: ctx.holderData.holderCount,
      minHolderCount: cfg.minHolderCount,
      topHolderPct: ctx.holderData.topHolderPercent.toFixed(1),
      maxTopHolderPct: cfg.maxTopHolderPercent,
      top5HolderPct: ctx.holderData.top5HolderPercent.toFixed(1),
      maxTop5HolderPct: cfg.maxTop5HolderPercent,
      top10HolderPct: ctx.holderData.top10HolderPercent?.toFixed(1) ?? 'n/a',
      maxTop10HolderPct: cfg.maxTop10HolderPercent,
      mintAuthDisabled: ctx.safetyData.mintAuthorityDisabled,
      freezeAbsent: ctx.safetyData.freezeAuthorityAbsent,
      buyTxLast60s: ctx.volumeContext.buyTxLast60s,
      buyTxLast120s: ctx.volumeContext.buyTxLast120s ?? 0,
      minBuys60s: cfg.minBuyTxLast60s,
      minBuys120s: cfg.minBuyTxLast120s,
      isBlacklisted: ctx.safetyData.isBlacklisted,
      rugScore: ctx.safetyData.rugScore,
      minRugScore: cfg.minRugScoreSignal,
    });

    if (ctx.poolAgeSec < cfg.minPoolAgeSec) {
      failed.push(`pool_age_too_low(${ctx.poolAgeSec.toFixed(0)}s<${cfg.minPoolAgeSec}s)`);
    }
    if (ctx.liquidity < cfg.minLiquiditySol) {
      failed.push(`liquidity_below_threshold(${ctx.liquidity.toFixed(1)}<${cfg.minLiquiditySol}SOL)`);
    }
    if (ctx.holderData.holderCount < cfg.minHolderCount) {
      failed.push(`holder_count_too_low(${ctx.holderData.holderCount}<${cfg.minHolderCount})`);
    }
    if (ctx.holderData.topHolderPercent > cfg.maxTopHolderPercent) {
      failed.push(`top_holder_too_high(${ctx.holderData.topHolderPercent.toFixed(1)}%>${cfg.maxTopHolderPercent}%)`);
    }
    if (ctx.holderData.top5HolderPercent > cfg.maxTop5HolderPercent) {
      failed.push(`top5_holder_too_high(${ctx.holderData.top5HolderPercent.toFixed(1)}%>${cfg.maxTop5HolderPercent}%)`);
    }
    const top10 = ctx.holderData.top10HolderPercent;
    if (top10 !== undefined && top10 > cfg.maxTop10HolderPercent) {
      failed.push(`top10_holder_too_high(${top10.toFixed(1)}%>${cfg.maxTop10HolderPercent}%)`);
    }
    if (!ctx.safetyData.mintAuthorityDisabled) {
      failed.push('mint_authority_active');
    }
    if (!ctx.safetyData.freezeAuthorityAbsent) {
      failed.push('freeze_authority_set');
    }
    const buyTx60s = ctx.volumeContext.buyTxLast60s;
    const buyTx120s = ctx.volumeContext.buyTxLast120s ?? Math.round((ctx.volumeContext.buyTxLast20 * 2) / 5);
    const hasBuyActivity = buyTx60s >= cfg.minBuyTxLast60s || buyTx120s >= cfg.minBuyTxLast120s;
    if (!hasBuyActivity) {
      failed.push(`buy_tx_too_low(60s=${buyTx60s}<${cfg.minBuyTxLast60s}, 120s=${buyTx120s}<${cfg.minBuyTxLast120s})`);
    }
    if (ctx.safetyData.isBlacklisted) {
      failed.push('token_blacklisted');
    }
    if (ctx.safetyData.rugScore < cfg.minRugScoreSignal) {
      failed.push(`rug_score_too_low(${ctx.safetyData.rugScore}<${cfg.minRugScoreSignal})`);
    }

    if (failed.length > 0) {
      logger.debug('SIGNAL_STACK_FAIL', { tokenMint, failedConditions: failed });
      return { passed: false, failedConditions: failed };
    }
    logger.debug('SIGNAL_STACK_PASSED', { tokenMint });
    return { passed: true, failedConditions: [] };
  }

  private isAntifomoTriggered(ctx: StrategyContext): boolean {
    const maxGain = this.tierConfig.entry.maxPriceGainFromLaunch;

    if (ctx.priceChangeFromLaunch > maxGain) {
      const hasSmartMoneyConfirmation = ctx.smartMoneyData.smartMoneyHolding && ctx.smartMoneyData.tier1WalletsBuying >= 1;
      const hasWhaleAccumulation = ctx.whaleData.whaleDistinctBuyers5min >= 2;

      if (!hasSmartMoneyConfirmation && !hasWhaleAccumulation) {
        return true;
      }
    }

    const totalTx20 = ctx.volumeContext.sellTxLast20 + ctx.volumeContext.buyTxLast20;
    if (totalTx20 > 0 && ctx.volumeContext.sellTxLast20 > ctx.volumeContext.buyTxLast20 * 1.5) {
      logger.debug('EntryStrategy: sell pressure significantly exceeds buy pressure in last 20 txns');
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
    // Type A (new_token_sniper) DISABLED — extreme rug pull probability on tokens < 60s
    // Usa pool_age como critério de maturidade (não token_age)

    if (ctx.poolAgeSec >= 120 && ctx.poolAgeSec <= 600 && ctx.poolInitialSol >= this.tierConfig.entry.minLiquiditySol) {
      return 'pool_creation_sniper';
    }

    if (ctx.previouslyTraded && ctx.priceDropFromPeak >= 35 && ctx.priceDropFromPeak <= 60) {
      return 'dip_reentry';
    }

    if (ctx.poolAgeSec >= 180 && ctx.poolAgeSec <= 1800) {
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
      case 'early_momentum':
        return { pass: false, reason: 'Early momentum handled by EarlyMomentumStrategy' };
    }
  }

  private evaluateTypeA(ctx: StrategyContext): { pass: boolean; reason: string } {
    if (ctx.poolAgeSec >= 60) {
      return { pass: false, reason: 'Pool age >= 60s for sniper mode' };
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
    const maxTopHolder = this.tierConfig.entry.maxTopHolderPercent;
    if (ctx.holderData.topHolderPercent > maxTopHolder) {
      return { pass: false, reason: `Top holder ${ctx.holderData.topHolderPercent.toFixed(1)}% > ${maxTopHolder}%` };
    }
    if (ctx.buySellRatio5min < 0.60) {
      return { pass: false, reason: `Buy/sell ratio ${ctx.buySellRatio5min.toFixed(2)} < 0.60` };
    }
    const uniqueBuyers2min = ctx.uniqueBuyers2min ?? ctx.volumeContext.buyTxLast60s;
    if (uniqueBuyers2min < 3) {
      return { pass: false, reason: `Unique buyers (2min) ${uniqueBuyers2min} < 3` };
    }
    return { pass: true, reason: 'Type B pool creation conditions met' };
  }

  private evaluateTypeC(ctx: StrategyContext): { pass: boolean; reason: string } {
    const volumeRatio = ctx.volumeContext.volume5minAvg > 0
      ? ctx.volumeContext.volume1min / ctx.volumeContext.volume5minAvg
      : 0;

    const minVolRatio = this.tierConfig.momentum.minVolumeMultiplier ?? 2.0;
    if (volumeRatio < minVolRatio) {
      return { pass: false, reason: `Volume ratio ${volumeRatio.toFixed(1)} < ${minVolRatio}x threshold` };
    }
    const priceChange = ctx.priceChangePercent5min || ctx.priceChangeFromLaunch;
    const minPriceChange = this.tierConfig.momentum.minPriceChange5min ?? 5;
    if (priceChange < minPriceChange || priceChange > 200) {
      return { pass: false, reason: `Price change ${priceChange.toFixed(1)}% not in ${minPriceChange}–200% range` };
    }
    if (ctx.buySellRatio5min < 0.55) {
      return { pass: false, reason: `Buy/sell ratio ${ctx.buySellRatio5min.toFixed(2)} < 0.55` };
    }
    const uniqueBuyers = ctx.uniqueBuyers5min || ctx.volumeContext.buyTxLast60s * 3;
    if (uniqueBuyers < 5) {
      return { pass: false, reason: `Unique buyers (5min) ${uniqueBuyers} < 5` };
    }
    return { pass: true, reason: 'Type C momentum confirmation conditions met' };
  }

  private evaluateTypeD(ctx: StrategyContext): { pass: boolean; reason: string } {
    if (!ctx.previouslyTraded) {
      return { pass: false, reason: 'Not previously traded' };
    }
    if (ctx.priceDropFromPeak < 35 || ctx.priceDropFromPeak > 60) {
      return { pass: false, reason: `Price drop ${ctx.priceDropFromPeak.toFixed(1)}% not in 35–60% range` };
    }
    const volumeRatio = ctx.volumeContext.volume5minAvg > 0
      ? ctx.volumeContext.volume1min / ctx.volumeContext.volume5minAvg
      : 0;
    if (volumeRatio < 0.70) {
      return { pass: false, reason: `Volume ratio ${volumeRatio.toFixed(2)} < 70% of average` };
    }
    if (ctx.holderData.holdersDecreasing) {
      return { pass: false, reason: 'Holder count is decreasing' };
    }
    if (ctx.buySellRatio5min < 0.55) {
      return { pass: false, reason: `Buy/sell ratio ${ctx.buySellRatio5min.toFixed(2)} < 0.55` };
    }
    return { pass: true, reason: 'Type D dip re-entry conditions met' };
  }

  private calculateSuggestedSize(
    ctx: StrategyContext,
    confidence: number,
    triggerType: EntryTriggerType,
  ): number {
    const cfg = this.tierConfig.entry;
    const maxPoolPercent = cfg.maxPositionPercent / 100;
    let sizeSol = ctx.liquidity * maxPoolPercent;

    sizeSol *= confidence;

    sizeSol = Math.max(cfg.solSizeMin, Math.min(cfg.solSizeMax, sizeSol));

    if (triggerType === 'dip_reentry') {
      sizeSol *= 0.4;
    }

    return Math.round(sizeSol * 1_000_000_000) / 1_000_000_000;
  }

  private estimateSlippageLoss(positionSol: number, poolLiquiditySol: number): number {
    if (poolLiquiditySol <= 0) return 1;
    return (positionSol / poolLiquiditySol) * 1.5;
  }
}
