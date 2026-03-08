import { BaseStrategy } from './BaseStrategy.js';
import { getTierConfig, LAUNCH_PHASE_RULES, type TierConfig } from './config.js';
import { logger } from '../utils/logger.js';
import type {
  StrategyContext,
  StrategyResult,
  StrategyTier,
  LaunchPhase,
} from '../types/strategy.types.js';

export class LaunchStrategy extends BaseStrategy {
  readonly name = 'LaunchStrategy';
  readonly description = 'Early token launch phases with sniper logic, Pump.fun graduation, and phase-based entry';
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

    const phase = this.determineLaunchPhase(context.tokenAgeSec);

    if (phase === 'birth') {
      return skip('Phase 0 (Birth): token too new — no trading');
    }

    if (phase === 'decline') {
      return skip('Phase 5 (Decline): token > 2h old — smart money exiting');
    }

    if (phase === 'peak') {
      return skip('Phase 4 (Peak/Distribution): risk increasing rapidly');
    }

    if (context.tokenSource === 'pumpfun') {
      const pumpResult = this.evaluatePumpFun(context, phase);
      if (pumpResult) return pumpResult;
    }

    if (phase === 'ignition') {
      return this.evaluatePhase1Sniper(context);
    }

    if (phase === 'discovery') {
      return this.evaluatePhase2Confirmation(context);
    }

    if (phase === 'momentum') {
      return this.evaluatePhase3Momentum(context);
    }

    return skip(`Launch phase ${phase} — no strategy matched`);
  }

  determineLaunchPhase(tokenAgeSec: number): LaunchPhase {
    if (tokenAgeSec < LAUNCH_PHASE_RULES.birthMaxSec) return 'birth';
    if (tokenAgeSec < LAUNCH_PHASE_RULES.ignitionMaxSec) return 'ignition';
    if (tokenAgeSec < LAUNCH_PHASE_RULES.discoveryMaxSec) return 'discovery';
    if (tokenAgeSec < LAUNCH_PHASE_RULES.momentumMaxSec) return 'momentum';
    if (tokenAgeSec < LAUNCH_PHASE_RULES.peakMaxSec) return 'peak';
    return 'decline';
  }

  private evaluatePhase1Sniper(context: StrategyContext): StrategyResult {
    const skip = (reason: string): StrategyResult => ({
      signal: 'skip',
      confidence: 0,
      reason,
      suggestedSizeSol: 0,
    });

    const cfg = this.tierConfig.launch;

    if (context.poolInitialSol < cfg.phase1MinPoolSol) {
      return skip(`Phase 1 GATE 1 fail: initial pool ${context.poolInitialSol.toFixed(2)} SOL < ${cfg.phase1MinPoolSol} SOL`);
    }

    if (context.safetyData.rugScore < cfg.phase1MinRugScore) {
      return skip(`Phase 1 GATE 2 fail: rug score ${context.safetyData.rugScore} < ${cfg.phase1MinRugScore}`);
    }

    if (!context.safetyData.mintAuthorityDisabled) {
      return skip('Phase 1 GATE 3 fail: mint authority not disabled');
    }

    if (
      !this.tierConfig.filter.skipBundleDetection &&
      context.safetyData.bundleDetected
    ) {
      return skip('Phase 1 GATE 4 fail: coordinated bundle launch detected');
    }

    if (
      !this.tierConfig.honeypot.skipHoneypotSimulation &&
      !context.safetyData.honeypotSimulationPassed
    ) {
      return skip('Phase 1: honeypot simulation not passed');
    }

    const maxSize = this.tierConfig.entry.solSizeMax;
    const portfolioPercent = cfg.phase1MaxPortfolioPercent / 100;
    const buySizeSol = Math.min(maxSize, context.liquidity * portfolioPercent);

    logger.debug('LaunchStrategy: Phase 1 SNIPER entry', {
      token: context.tokenInfo.mintAddress,
      ageSec: context.tokenAgeSec,
      poolSol: context.poolInitialSol,
      rugScore: context.safetyData.rugScore,
      buySizeSol: buySizeSol.toFixed(4),
    });

    return {
      signal: 'buy',
      confidence: 0.65,
      reason: `Phase 1 sniper: all gates passed, pool ${context.poolInitialSol.toFixed(1)} SOL, rug ${context.safetyData.rugScore}`,
      suggestedSizeSol: Math.max(this.tierConfig.entry.solSizeMin, buySizeSol),
      triggerType: 'new_token_sniper',
    };
  }

  private evaluatePhase2Confirmation(context: StrategyContext): StrategyResult {
    const skip = (reason: string): StrategyResult => ({
      signal: 'skip',
      confidence: 0,
      reason,
      suggestedSizeSol: 0,
    });

    const cfg = this.tierConfig.launch;

    if (context.holderData.holderCount < cfg.phase2MinHolders) {
      return skip(`Phase 2: holder count ${context.holderData.holderCount} < ${cfg.phase2MinHolders}`);
    }

    if (context.uniqueBuyers5min < cfg.phase2MinUniqueBuyers) {
      return skip(`Phase 2: unique buyers ${context.uniqueBuyers5min} < ${cfg.phase2MinUniqueBuyers}`);
    }

    if (context.buySellRatio5min < cfg.phase2MinBuySellRatio) {
      return skip(`Phase 2: buy/sell ratio ${context.buySellRatio5min.toFixed(2)} < ${cfg.phase2MinBuySellRatio}`);
    }

    if (context.priceChangeFromLaunch <= 0) {
      return skip('Phase 2: no positive price action from launch');
    }

    if (context.priceChangeFromLaunch > cfg.phase2MaxPriceFromLaunch) {
      return skip(`Phase 2: already pumped ${context.priceChangeFromLaunch.toFixed(0)}% > ${cfg.phase2MaxPriceFromLaunch}%`);
    }

    if (!context.liquidityStable) {
      return skip('Phase 2: liquidity unstable (>5% change in 2min)');
    }

    if (!context.safetyData.mintAuthorityDisabled || !context.safetyData.freezeAuthorityAbsent) {
      return skip('Phase 2: safety checks failed (mint/freeze authority)');
    }

    if (context.safetyData.rugScore < this.tierConfig.entry.minEntryScore * 0.8) {
      return skip(`Phase 2: rug score ${context.safetyData.rugScore} too low`);
    }

    if (
      !this.tierConfig.honeypot.skipHoneypotSimulation &&
      !context.safetyData.honeypotSimulationPassed
    ) {
      return skip('Phase 2: honeypot simulation not passed');
    }

    const confidence = 0.75;
    const sizeSol = this.tierConfig.entry.solSizeMax * confidence;

    logger.debug('LaunchStrategy: Phase 2 CONFIRMATION entry', {
      token: context.tokenInfo.mintAddress,
      ageSec: context.tokenAgeSec,
      holders: context.holderData.holderCount,
      uniqueBuyers: context.uniqueBuyers5min,
      priceFromLaunch: context.priceChangeFromLaunch.toFixed(1),
    });

    return {
      signal: 'buy',
      confidence,
      reason: `Phase 2 confirmed: ${context.holderData.holderCount} holders, ${context.uniqueBuyers5min} unique buyers, +${context.priceChangeFromLaunch.toFixed(0)}%`,
      suggestedSizeSol: Math.max(this.tierConfig.entry.solSizeMin, sizeSol),
      triggerType: 'pool_creation_sniper',
    };
  }

  private evaluatePhase3Momentum(context: StrategyContext): StrategyResult {
    const skip = (reason: string): StrategyResult => ({
      signal: 'skip',
      confidence: 0,
      reason,
      suggestedSizeSol: 0,
    });

    if (!context.priceRising) {
      return skip('Phase 3: price not rising');
    }

    const volumeRatio = context.volumeContext.volume5minAvg > 0
      ? context.volumeContext.volume1min / context.volumeContext.volume5minAvg
      : 0;

    if (volumeRatio < 1.5) {
      return skip(`Phase 3: volume momentum weak (${volumeRatio.toFixed(1)}x)`);
    }

    if (context.holderData.holdersDecreasing) {
      return skip('Phase 3: holders decreasing — late entry risk');
    }

    if (
      !this.tierConfig.honeypot.skipHoneypotSimulation &&
      !context.safetyData.honeypotSimulationPassed
    ) {
      return skip('Phase 3: honeypot simulation not passed');
    }

    const confidence = Math.min(0.65, volumeRatio / 5);
    const sizeSol = this.tierConfig.entry.solSizeMin * 1.5;

    return {
      signal: 'buy',
      confidence,
      reason: `Phase 3 momentum: vol ${volumeRatio.toFixed(1)}x, still growing`,
      suggestedSizeSol: Math.max(this.tierConfig.entry.solSizeMin, sizeSol),
      triggerType: 'momentum_confirmation',
    };
  }

  private evaluatePumpFun(context: StrategyContext, phase: LaunchPhase): StrategyResult | null {
    const cfg = this.tierConfig.launch;

    if (context.pumpfunCreationRatePerHour > cfg.pumpfunOverheatRate) {
      logger.warn('LaunchStrategy: Pump.fun overheated — raising thresholds', {
        rate: context.pumpfunCreationRatePerHour,
        threshold: cfg.pumpfunOverheatRate,
      });
      return {
        signal: 'skip',
        confidence: 0,
        reason: `Pump.fun overheated: ${context.pumpfunCreationRatePerHour} tokens/hour > ${cfg.pumpfunOverheatRate}`,
        suggestedSizeSol: 0,
      };
    }

    if (context.pumpfunMarketCap < cfg.pumpfunPreGradMaxMcap && phase === 'ignition') {
      return null;
    }

    if (
      context.pumpfunMarketCap >= cfg.pumpfunNearGradMinMcap &&
      context.pumpfunMarketCap < cfg.pumpfunGradMcap &&
      !context.pumpfunGraduated
    ) {
      if (
        !this.tierConfig.honeypot.skipHoneypotSimulation &&
        !context.safetyData.honeypotSimulationPassed
      ) {
        return null;
      }

      const confidence = 0.70;
      const sizeSol = this.tierConfig.entry.solSizeMax * 0.6;

      logger.debug('LaunchStrategy: Pump.fun NEAR-GRADUATION entry', {
        token: context.tokenInfo.mintAddress,
        mcap: context.pumpfunMarketCap,
      });

      return {
        signal: 'buy',
        confidence,
        reason: `Pump.fun near graduation: mcap $${(context.pumpfunMarketCap / 1000).toFixed(1)}K, anticipating Raydium listing`,
        suggestedSizeSol: Math.max(this.tierConfig.entry.solSizeMin, sizeSol),
        triggerType: 'pool_creation_sniper',
      };
    }

    if (context.pumpfunGraduated && context.pumpfunMarketCap >= cfg.pumpfunGradMcap) {
      logger.debug('LaunchStrategy: Pump.fun GRADUATION event detected', {
        token: context.tokenInfo.mintAddress,
        mcap: context.pumpfunMarketCap,
      });
      return null;
    }

    return null;
  }
}
