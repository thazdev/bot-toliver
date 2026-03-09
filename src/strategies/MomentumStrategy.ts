import { BaseStrategy } from './BaseStrategy.js';
import { getTierConfig, VOLUME_ANOMALY_RULES, type TierConfig } from './config.js';
import { logger } from '../utils/logger.js';
import type {
  StrategyContext,
  StrategyResult,
  StrategyTier,
  MomentumSnapshot,
} from '../types/strategy.types.js';

export class MomentumStrategy extends BaseStrategy {
  readonly name = 'MomentumStrategy';
  readonly description = 'Volume & momentum scoring with wash-trade detection and decay tracking';
  readonly version = '1.0.0';

  private tier: StrategyTier;
  private tierConfig: TierConfig;
  private snapshots: Map<string, MomentumSnapshot[]> = new Map();

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

    if (this.isWashTrading(context)) {
      return skip('Volume anomaly: wash trading detected');
    }

    const momentumScore = this.calculateMomentumScore(context);
    this.recordSnapshot(context.tokenInfo.mintAddress, momentumScore, context);

    const volTrend = this.calculateVolTrend(context);
    const cfg = this.tierConfig.momentum;
    const hasVolumeData = context.volumeContext.volume5minAvg > 0;

    if (hasVolumeData && volTrend < cfg.volumeCollapsingThreshold) {
      if (context.position) {
        return {
          signal: 'sell',
          confidence: 0.8,
          reason: `Volume collapsing (trend ${volTrend.toFixed(2)} < ${cfg.volumeCollapsingThreshold}) — sell 50%`,
          suggestedSizeSol: 0,
        };
      }
      return skip(`Volume collapsing: vol_trend ${volTrend.toFixed(2)} < ${cfg.volumeCollapsingThreshold}`);
    }

    if (!hasVolumeData) {
      return skip('No volume data available — skipping momentum evaluation');
    }

    const decayDecision = this.checkMomentumDecay(context.tokenInfo.mintAddress, context);
    if (decayDecision) {
      return decayDecision;
    }

    if (volTrend > cfg.absorptionVolTrend && !context.priceRising) {
      return skip(`Absorption pattern: high volume (${volTrend.toFixed(2)}x) but flat price — wait for confirmation`);
    }

    if (volTrend > cfg.strongMomentumVolTrend && context.priceRising) {
      const confidence = Math.min(1.0, (momentumScore / 100) + 0.15);
      const sizeSol = this.tierConfig.entry.solSizeMax * confidence;

      logger.debug('MomentumStrategy: STRONG MOMENTUM BUY', {
        token: context.tokenInfo.mintAddress,
        volTrend: volTrend.toFixed(2),
        momentumScore: momentumScore.toFixed(1),
        scoreBoost: cfg.strongMomentumScoreBoost,
      });

      return {
        signal: 'buy',
        confidence,
        reason: `Strong momentum: vol_trend ${volTrend.toFixed(2)}x, score ${momentumScore.toFixed(1)} (+${cfg.strongMomentumScoreBoost} boost)`,
        suggestedSizeSol: Math.max(this.tierConfig.entry.solSizeMin, sizeSol),
      };
    }

    if (volTrend >= cfg.moderateMomentumVolTrend && context.priceRising) {
      const confidence = Math.min(1.0, momentumScore / 100);
      const sizeSol = this.tierConfig.entry.solSizeMin * confidence;

      return {
        signal: 'buy',
        confidence: confidence * 0.8,
        reason: `Moderate momentum: vol_trend ${volTrend.toFixed(2)}x, score ${momentumScore.toFixed(1)}`,
        suggestedSizeSol: Math.max(this.tierConfig.entry.solSizeMin, sizeSol),
      };
    }

    return skip(`Insufficient momentum: vol_trend ${volTrend.toFixed(2)}, score ${momentumScore.toFixed(1)}`);
  }

  calculateMomentumScore(context: StrategyContext): number {
    const priceVelocity = this.calculatePriceVelocity(context);
    const volumeAcceleration = this.calculateVolumeAcceleration(context);
    const txFrequency = Math.min(100, context.volumeContext.txnsPerMinute);

    return (priceVelocity * 0.30) + (volumeAcceleration * 0.40) + (txFrequency * 0.30);
  }

  private calculatePriceVelocity(context: StrategyContext): number {
    if (context.price60sAgo <= 0) return 0;
    const velocity = ((context.currentPrice - context.price60sAgo) / context.price60sAgo) * 100;
    return Math.max(0, Math.min(100, velocity));
  }

  private calculateVolumeAcceleration(context: StrategyContext): number {
    const prev = context.volumeContext.volumePrev60s;
    if (prev <= 0) return 0;
    const acceleration = ((context.volumeContext.volume1min - prev) / prev) * 100;
    return Math.max(0, Math.min(100, acceleration));
  }

  private calculateVolTrend(context: StrategyContext): number {
    if (context.volumeContext.volume5minAvg <= 0) return 0;
    return context.volumeContext.volume1min / context.volumeContext.volume5minAvg;
  }

  isWashTrading(context: StrategyContext): boolean {
    const vol = context.volumeContext;
    const minWallets = parseInt(process.env.WASH_MIN_UNIQUE_WALLETS ?? '1', 10) || 1;
    const minBuyRatio = parseFloat(process.env.WASH_MIN_BUY_RATIO ?? '0.15') || 0.15;
    const maxBuyRatio = parseFloat(process.env.WASH_MAX_BUY_RATIO ?? '0.99') || 0.99;
    const maxTimingScore = parseFloat(process.env.WASH_MAX_TIMING_SCORE ?? '0.99') || 0.99;

    if (vol.uniqueWalletsPerVolume < minWallets) {
      logger.debug('MomentumStrategy: low unique wallets per volume — likely wash trading', {
        uniqueWallets: vol.uniqueWalletsPerVolume,
        threshold: minWallets,
      });
      return true;
    }

    const allowUniformSizes = process.env.WASH_ALLOW_UNIFORM_SIZES === 'true';
    if (!allowUniformSizes && vol.tradeSizeStdDev < VOLUME_ANOMALY_RULES.tradeSizeVarianceMin && vol.avgTradeSize > 0) {
      logger.debug('MomentumStrategy: uniform trade sizes — likely bot volume', {
        stdDev: vol.tradeSizeStdDev,
      });
      return true;
    }

    if (vol.buyRatio < minBuyRatio || vol.buyRatio > maxBuyRatio) {
      logger.debug('MomentumStrategy: buy ratio out of healthy range — likely manipulated', {
        buyRatio: vol.buyRatio,
        min: minBuyRatio,
        max: maxBuyRatio,
      });
      return true;
    }

    if (vol.tradeTimeDistributionScore > maxTimingScore) {
      logger.debug('MomentumStrategy: trades too regularly spaced — automated wash');
      return true;
    }

    if (vol.selfTradingDetected) {
      logger.debug('MomentumStrategy: self-trading detected — same wallet buy+sell within 10s');
      return true;
    }

    return false;
  }

  private recordSnapshot(tokenMint: string, score: number, context: StrategyContext): void {
    const existing = this.snapshots.get(tokenMint) ?? [];
    existing.push({
      momentumScore: score,
      priceVelocity: this.calculatePriceVelocity(context),
      volumeAcceleration: this.calculateVolumeAcceleration(context),
      txFrequency: Math.min(100, context.volumeContext.txnsPerMinute),
      timestamp: Date.now(),
    });

    const cutoff = Date.now() - 5 * 60 * 1000;
    const filtered = existing.filter(s => s.timestamp > cutoff);
    this.snapshots.set(tokenMint, filtered);
  }

  private checkMomentumDecay(tokenMint: string, context: StrategyContext): StrategyResult | null {
    if (!context.position) return null;

    const history = this.snapshots.get(tokenMint);
    if (!history || history.length < 2) return null;

    const now = history[history.length - 1];
    const ago60s = history.find(s => Math.abs(s.timestamp - (Date.now() - 60_000)) < 15_000);
    if (!ago60s || ago60s.momentumScore <= 0) return null;

    const decay = (now.momentumScore - ago60s.momentumScore) / ago60s.momentumScore;
    const cfg = this.tierConfig.momentum;

    if (decay < cfg.momentumDecayStage3) {
      logger.warn('MomentumStrategy: severe momentum decay — EXIT ALL', {
        token: tokenMint,
        decay: (decay * 100).toFixed(1),
      });
      return {
        signal: 'sell',
        confidence: 1.0,
        reason: `Momentum decay ${(decay * 100).toFixed(1)}% < ${cfg.momentumDecayStage3 * 100}% — full exit`,
        suggestedSizeSol: 0,
      };
    }

    if (decay < cfg.momentumDecayStage2) {
      return {
        signal: 'sell',
        confidence: 0.85,
        reason: `Momentum decay ${(decay * 100).toFixed(1)}% — sell ${cfg.momentumDecaySell2Percent}% of remaining`,
        suggestedSizeSol: 0,
      };
    }

    if (decay < cfg.momentumDecayStage1) {
      return {
        signal: 'sell',
        confidence: 0.7,
        reason: `Momentum decay ${(decay * 100).toFixed(1)}% — staged exit: sell ${cfg.momentumDecaySell1Percent}%`,
        suggestedSizeSol: 0,
      };
    }

    return null;
  }

  clearSnapshots(tokenMint: string): void {
    this.snapshots.delete(tokenMint);
  }
}
