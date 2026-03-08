import { logger } from '../utils/logger.js';
import { getTierConfig, type TierConfig, type FilterConfig } from './config.js';
import type {
  StrategyTier,
  StrategyContext,
  FilterPipelineResult,
  TradeFilterOutcome,
  StrategyFeedbackReport,
  SentimentRegime,
} from '../types/strategy.types.js';

interface RejectionRecord {
  tokenMint: string;
  step: string;
  reason: string;
  scores: Record<string, number>;
  timestamp: number;
}

interface TradeOutcomeRecord {
  tokenMint: string;
  entryScore: number;
  rugScore: number;
  pnlPercent: number;
  holdTimeMs: number;
  hitStopLoss: boolean;
  tier: StrategyTier;
  timestamp: number;
}

export class TradeFilterPipeline {
  private tier: StrategyTier;
  private tierConfig: TierConfig;
  private filterConfig: FilterConfig;
  private rejections: RejectionRecord[] = [];
  private tradeOutcomes: TradeOutcomeRecord[] = [];
  private parameterVersion: number = 1;
  private activeOverrides: Map<string, boolean> = new Map();
  private blacklistedAddresses: Set<string> = new Set();
  private knownRugDevs: Set<string> = new Set();
  private honeypotDb: Set<string> = new Set();
  private emergencyHalt: boolean = false;

  constructor(tier: StrategyTier) {
    this.tier = tier;
    this.tierConfig = getTierConfig(tier);
    this.filterConfig = this.tierConfig.filter;
  }

  async runPipeline(context: StrategyContext): Promise<TradeFilterOutcome> {
    const startMs = Date.now();
    const steps: FilterPipelineResult[] = [];
    const tokenMint = context.tokenInfo.mintAddress;

    if (this.emergencyHalt) {
      steps.push({ step: 'emergency_halt', passed: false, reason: 'Emergency halt active via admin override', durationMs: 0 });
      return this.buildOutcome(tokenMint, steps, startMs, 0);
    }

    const step2 = this.step2HardReject(context);
    steps.push(step2);
    if (!step2.passed) return this.buildOutcome(tokenMint, steps, startMs, 0);

    const step3 = this.step3BasicViability(context);
    steps.push(step3);
    if (!step3.passed) return this.buildOutcome(tokenMint, steps, startMs, 0);

    const step4 = this.step4DeepAnalysis(context);
    steps.push(step4);
    if (!step4.passed) return this.buildOutcome(tokenMint, steps, startMs, 0);

    const step5 = this.step5MarketContext(context);
    steps.push(step5);
    if (!step5.passed) return this.buildOutcome(tokenMint, steps, startMs, 0);

    const entryScore = step4.scores?.['entryScore'] ?? 0;
    let adjustedScore = entryScore;

    const overrideResult = this.applyOverrides(context, adjustedScore);
    adjustedScore = overrideResult.adjustedScore;
    if (overrideResult.step) steps.push(overrideResult.step);

    const step6 = this.step6SizingRiskCheck(context);
    steps.push(step6);
    if (!step6.passed) return this.buildOutcome(tokenMint, steps, startMs, adjustedScore);

    const threshold = this.filterConfig.minEntryScoreThreshold;
    if (adjustedScore < threshold) {
      steps.push({
        step: 'final_score_gate',
        passed: false,
        reason: `Entry score ${adjustedScore.toFixed(1)} < threshold ${threshold}`,
        durationMs: 0,
        scores: { entryScore: adjustedScore, threshold },
      });
      return this.buildOutcome(tokenMint, steps, startMs, adjustedScore);
    }

    steps.push({
      step: 'final_score_gate',
      passed: true,
      reason: `Entry score ${adjustedScore.toFixed(1)} ≥ ${threshold} — APPROVED for execution`,
      durationMs: 0,
      scores: { entryScore: adjustedScore, threshold },
    });

    return this.buildOutcome(tokenMint, steps, startMs, adjustedScore);
  }

  private step2HardReject(context: StrategyContext): FilterPipelineResult {
    const start = Date.now();
    const token = context.tokenInfo.mintAddress;

    if (this.blacklistedAddresses.has(token)) {
      return { step: 'hard_reject', passed: false, reason: 'Blacklisted address', durationMs: Date.now() - start };
    }

    if (this.knownRugDevs.has(token)) {
      return { step: 'hard_reject', passed: false, reason: 'Known rug dev wallet', durationMs: Date.now() - start };
    }

    if (this.honeypotDb.has(token)) {
      return { step: 'hard_reject', passed: false, reason: 'Known honeypot in DB', durationMs: Date.now() - start };
    }

    if (context.tokenAgeSec < this.filterConfig.deferTokenAgeSec) {
      return { step: 'hard_reject', passed: false, reason: `Token age ${context.tokenAgeSec.toFixed(0)}s < ${this.filterConfig.deferTokenAgeSec}s — DEFERRED`, durationMs: Date.now() - start };
    }

    if (context.safetyData.isBlacklisted) {
      return { step: 'hard_reject', passed: false, reason: 'Token is blacklisted', durationMs: Date.now() - start };
    }

    return { step: 'hard_reject', passed: true, reason: 'Passed hard reject filter', durationMs: Date.now() - start };
  }

  private step3BasicViability(context: StrategyContext): FilterPipelineResult {
    const start = Date.now();

    if (context.liquidity < this.tierConfig.entry.minLiquiditySol) {
      return {
        step: 'basic_viability',
        passed: false,
        reason: `Liquidity ${context.liquidity.toFixed(2)} SOL < min ${this.tierConfig.entry.minLiquiditySol}`,
        durationMs: Date.now() - start,
      };
    }

    if (!context.safetyData.mintAuthorityDisabled) {
      return { step: 'basic_viability', passed: false, reason: 'Mint authority not disabled', durationMs: Date.now() - start };
    }

    if (!context.safetyData.freezeAuthorityAbsent) {
      return { step: 'basic_viability', passed: false, reason: 'Freeze authority present', durationMs: Date.now() - start };
    }

    if (context.safetyData.rugScore < this.filterConfig.minRugScoreStep3) {
      return {
        step: 'basic_viability',
        passed: false,
        reason: `Rug score ${context.safetyData.rugScore} < ${this.filterConfig.minRugScoreStep3}`,
        durationMs: Date.now() - start,
        scores: { rugScore: context.safetyData.rugScore },
      };
    }

    return { step: 'basic_viability', passed: true, reason: 'Basic viability passed', durationMs: Date.now() - start };
  }

  private step4DeepAnalysis(context: StrategyContext): FilterPipelineResult {
    const start = Date.now();

    if (context.holderData.topHolderPercent > this.tierConfig.entry.maxTopHolderPercent) {
      return {
        step: 'deep_analysis',
        passed: false,
        reason: `Top holder ${context.holderData.topHolderPercent}% > max ${this.tierConfig.entry.maxTopHolderPercent}%`,
        durationMs: Date.now() - start,
      };
    }

    if (!context.safetyData.honeypotSimulationPassed) {
      return { step: 'deep_analysis', passed: false, reason: 'Honeypot simulation failed', durationMs: Date.now() - start };
    }

    const entryScore = this.computeEntryScore(context);

    return {
      step: 'deep_analysis',
      passed: true,
      reason: `Deep analysis passed, entry score: ${entryScore.toFixed(1)}`,
      durationMs: Date.now() - start,
      scores: { entryScore },
    };
  }

  private step5MarketContext(context: StrategyContext): FilterPipelineResult {
    const start = Date.now();

    if (context.sentimentData.sentimentRegime === 'panic') {
      return { step: 'market_context', passed: false, reason: 'Sentiment regime: PANIC — new entries suspended', durationMs: Date.now() - start };
    }

    if (context.consecutiveLosses >= 5) {
      return { step: 'market_context', passed: false, reason: '5+ consecutive losses — no-trade condition', durationMs: Date.now() - start };
    }

    if (context.dailyLossPercent >= 5) {
      return { step: 'market_context', passed: false, reason: `Daily loss ${context.dailyLossPercent.toFixed(1)}% ≥ 5% — no-trade condition`, durationMs: Date.now() - start };
    }

    if (!context.jupiterAvailable) {
      return { step: 'market_context', passed: false, reason: 'Jupiter unavailable', durationMs: Date.now() - start };
    }

    return { step: 'market_context', passed: true, reason: 'Market context clear', durationMs: Date.now() - start };
  }

  private step6SizingRiskCheck(context: StrategyContext): FilterPipelineResult {
    const start = Date.now();

    if (context.hotWalletBalance < 0.1) {
      return { step: 'sizing_risk', passed: false, reason: 'Insufficient hot wallet balance', durationMs: Date.now() - start };
    }

    return { step: 'sizing_risk', passed: true, reason: 'Sizing and risk check passed', durationMs: Date.now() - start };
  }

  private applyOverrides(
    context: StrategyContext,
    score: number,
  ): { adjustedScore: number; step?: FilterPipelineResult } {
    let adjustedScore = score;

    // Bypass: liquidez alta + segurança básica — permite LaunchStrategy Phase 1 / sniper early
    const minLiquidityBypass = 12;
    if (
      context.liquidity >= minLiquidityBypass &&
      context.holderData.holderCount >= 3 &&
      context.safetyData.rugScore >= 60 &&
      context.safetyData.mintAuthorityDisabled &&
      context.safetyData.freezeAuthorityAbsent
    ) {
      adjustedScore = Math.max(adjustedScore, this.filterConfig.minEntryScoreThreshold);
      return {
        adjustedScore,
        step: {
          step: 'override_liquidity_safety',
          passed: true,
          reason: `Liquidity ${context.liquidity.toFixed(1)} SOL, ${context.holderData.holderCount} holders — liquidity+safety bypass`,
          durationMs: 0,
        },
      };
    }

    if (context.smartMoneyData.tier1WalletsBuying >= this.filterConfig.smartMoneyOverrideMinWallets) {
      adjustedScore = Math.max(adjustedScore, this.filterConfig.minEntryScoreThreshold);
      return {
        adjustedScore,
        step: {
          step: 'override_smart_money',
          passed: true,
          reason: `${context.smartMoneyData.tier1WalletsBuying} tier-1 wallets — soft filter bypass`,
          durationMs: 0,
        },
      };
    }

    if (context.safetyData.rugScore >= this.filterConfig.extremeRugScoreOverride) {
      adjustedScore += this.filterConfig.extremeRugScoreBonus;
      return {
        adjustedScore,
        step: {
          step: 'override_extreme_rug',
          passed: true,
          reason: `Rug score ${context.safetyData.rugScore} ≥ ${this.filterConfig.extremeRugScoreOverride} — threshold reduced by ${this.filterConfig.extremeRugScoreBonus}`,
          durationMs: 0,
        },
      };
    }

    if (context.sentimentData.sentimentScore >= this.filterConfig.euphoriaOverrideScore) {
      return {
        adjustedScore,
        step: {
          step: 'override_euphoria',
          passed: true,
          reason: `Sentiment ${context.sentimentData.sentimentScore} ≥ ${this.filterConfig.euphoriaOverrideScore} — aggressive tier override`,
          durationMs: 0,
        },
      };
    }

    return { adjustedScore };
  }

  private computeEntryScore(context: StrategyContext): number {
    const liquidityScore = Math.min(100, (context.liquidity / 50) * 100);
    const holderScore = Math.min(100, (context.holderData.holderCount / 100) * 100);
    const safetyScore = context.safetyData.rugScore;
    const smartMoneyScore = context.smartMoneyData.smartMoneyScore;

    const volumeRatio = context.volumeContext.volume5minAvg > 0
      ? context.volumeContext.volume1min / context.volumeContext.volume5minAvg
      : 0;
    // Quando volume não está disponível (0), usa score neutro 50 para não penalizar tokens novos
    const momentumScore = context.volumeContext.volume5minAvg > 0
      ? Math.min(100, volumeRatio * 33)
      : 50;

    return (liquidityScore * 0.25) + (holderScore * 0.20) + (momentumScore * 0.20) + (safetyScore * 0.25) + (smartMoneyScore * 0.10);
  }

  private buildOutcome(
    tokenMint: string,
    steps: FilterPipelineResult[],
    startMs: number,
    entryScore: number,
  ): TradeFilterOutcome {
    const passed = steps.every(s => s.passed);
    const failedStep = steps.find(s => !s.passed);

    if (!passed && failedStep) {
      this.rejections.push({
        tokenMint,
        step: failedStep.step,
        reason: failedStep.reason,
        scores: failedStep.scores ?? {},
        timestamp: Date.now(),
      });
    }

    return {
      tokenMint,
      passed,
      steps,
      totalDurationMs: Date.now() - startMs,
      finalEntryScore: entryScore,
      rejectionReason: failedStep?.reason,
    };
  }

  recordTradeOutcome(outcome: TradeOutcomeRecord): void {
    this.tradeOutcomes.push(outcome);

    const maxHistory = 10_000;
    if (this.tradeOutcomes.length > maxHistory) {
      this.tradeOutcomes = this.tradeOutcomes.slice(-maxHistory);
    }
  }

  private lastRejectionSummaryAt = 0;

  /** Loga resumo das rejeições a cada ~2 min para diagnóstico */
  logRejectionSummaryIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastRejectionSummaryAt < 120_000) return;
    this.lastRejectionSummaryAt = now;

    const recent = this.rejections.slice(-100);
    const byStep = new Map<string, number>();
    for (const r of recent) {
      byStep.set(r.step, (byStep.get(r.step) ?? 0) + 1);
    }
    const sorted = [...byStep.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      logger.info('Resumo de rejeições (últimos 100 tokens)', {
        total: recent.length,
        porStep: Object.fromEntries(sorted),
      });
    }
  }

  generateFeedbackReport(periodDays: number = 7): StrategyFeedbackReport {
    const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
    const recentTrades = this.tradeOutcomes.filter(t => t.timestamp > cutoff);

    if (recentTrades.length < this.filterConfig.feedbackMinSampleSize) {
      logger.info('TradeFilterPipeline: insufficient data for feedback', {
        trades: recentTrades.length,
        required: this.filterConfig.feedbackMinSampleSize,
      });
    }

    const wins = recentTrades.filter(t => t.pnlPercent > 0);
    const winRate = recentTrades.length > 0 ? (wins.length / recentTrades.length) * 100 : 0;
    const avgRoi = recentTrades.length > 0
      ? recentTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / recentTrades.length
      : 0;
    const avgHoldTime = recentTrades.length > 0
      ? recentTrades.reduce((sum, t) => sum + t.holdTimeMs, 0) / recentTrades.length
      : 0;

    const scoreBuckets = new Map<number, { wins: number; total: number }>();
    for (const trade of recentTrades) {
      const bucket = Math.floor(trade.entryScore / 5) * 5;
      const existing = scoreBuckets.get(bucket) ?? { wins: 0, total: 0 };
      existing.total++;
      if (trade.pnlPercent > 0) existing.wins++;
      scoreBuckets.set(bucket, existing);
    }

    let bestBucket = 0;
    let bestWinRate = 0;
    for (const [bucket, data] of scoreBuckets) {
      const bucketWinRate = data.total > 5 ? data.wins / data.total : 0;
      if (bucketWinRate > bestWinRate) {
        bestWinRate = bucketWinRate;
        bestBucket = bucket;
      }
    }

    const stoppedOut = recentTrades.filter(t => t.hitStopLoss);
    let optimalRugThreshold = this.filterConfig.minRugScoreStep3;
    if (stoppedOut.length > 0) {
      const avgRugScore = stoppedOut.reduce((s, t) => s + t.rugScore, 0) / stoppedOut.length;
      optimalRugThreshold = Math.ceil(avgRugScore + 5);
    }

    const adjustments: Record<string, { current: number; recommended: number }> = {};
    const maxAdj = this.filterConfig.feedbackAutoAdjustMaxPct / 100;

    if (recentTrades.length >= this.filterConfig.feedbackMinSampleSize) {
      const currentThreshold = this.filterConfig.minEntryScoreThreshold;
      if (winRate < 30) {
        const rec = Math.min(currentThreshold * (1 + maxAdj), currentThreshold + 5);
        adjustments['minEntryScoreThreshold'] = { current: currentThreshold, recommended: rec };
      } else if (winRate > 60 && avgRoi > 50) {
        const rec = Math.max(currentThreshold * (1 - maxAdj), currentThreshold - 5);
        adjustments['minEntryScoreThreshold'] = { current: currentThreshold, recommended: rec };
      }
    }

    const report: StrategyFeedbackReport = {
      period: `${periodDays}d`,
      winRate,
      avgRoi,
      avgHoldTimeMs: avgHoldTime,
      bestEntryScoreRange: [bestBucket, bestBucket + 5],
      optimalRugScoreThreshold: optimalRugThreshold,
      topPredictiveSmartWallets: [],
      parameterAdjustments: adjustments,
    };

    logger.info('TradeFilterPipeline: feedback report generated', {
      period: report.period,
      winRate: report.winRate.toFixed(1),
      avgRoi: report.avgRoi.toFixed(2),
      adjustments: Object.keys(adjustments).length,
      version: this.parameterVersion,
    });

    return report;
  }

  applyFeedbackAdjustments(report: StrategyFeedbackReport): void {
    if (this.tradeOutcomes.length < this.filterConfig.feedbackMinSampleSize) {
      logger.warn('TradeFilterPipeline: skipping auto-adjust — insufficient sample', {
        count: this.tradeOutcomes.length,
        required: this.filterConfig.feedbackMinSampleSize,
      });
      return;
    }

    for (const [param, adj] of Object.entries(report.parameterAdjustments)) {
      const changePct = Math.abs(adj.recommended - adj.current) / adj.current;
      if (changePct <= this.filterConfig.feedbackAutoAdjustMaxPct / 100) {
        logger.info('TradeFilterPipeline: auto-adjusting parameter', {
          param,
          from: adj.current,
          to: adj.recommended,
          changePct: (changePct * 100).toFixed(1),
          version: this.parameterVersion + 1,
        });
      }
    }

    this.parameterVersion++;
  }

  addToBlacklist(address: string): void {
    this.blacklistedAddresses.add(address);
  }

  addRugDev(devWallet: string): void {
    this.knownRugDevs.add(devWallet);
  }

  addHoneypot(tokenMint: string): void {
    this.honeypotDb.add(tokenMint);
  }

  setEmergencyHalt(halt: boolean): void {
    this.emergencyHalt = halt;
    logger.warn('TradeFilterPipeline: emergency halt', { active: halt });
  }

  getRejectionStats(periodMs: number = 24 * 60 * 60 * 1000): Record<string, number> {
    const cutoff = Date.now() - periodMs;
    const recent = this.rejections.filter(r => r.timestamp > cutoff);

    const stats: Record<string, number> = {};
    for (const r of recent) {
      stats[r.step] = (stats[r.step] ?? 0) + 1;
    }
    return stats;
  }

  getPassRate(periodMs: number = 24 * 60 * 60 * 1000): { total: number; passed: number; rate: number } {
    const cutoff = Date.now() - periodMs;
    const total = this.rejections.filter(r => r.timestamp > cutoff).length;
    const outcomes = this.tradeOutcomes.filter(t => t.timestamp > cutoff);
    const passed = outcomes.length;
    return {
      total: total + passed,
      passed,
      rate: (total + passed) > 0 ? (passed / (total + passed)) * 100 : 0,
    };
  }
}
