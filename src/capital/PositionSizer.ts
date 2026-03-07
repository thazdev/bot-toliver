import { logger } from '../utils/logger.js';
import { ExposureTracker } from '../risk/ExposureTracker.js';
import { getTierConfig, CONSECUTIVE_LOSS_RULES, type TierConfig } from '../strategies/config.js';
import type { AppConfig } from '../types/config.types.js';
import type { StrategyTier } from '../types/strategy.types.js';

interface TradeHistory {
  winRate: number;
  avgWinPercent: number;
  avgLossPercent: number;
  totalTrades: number;
}

export class PositionSizer {
  private maxPositionSizeSol: number;
  private totalCapitalSol: number;
  private exposureTracker: ExposureTracker;
  private tierConfig: TierConfig;

  private consecutiveLosses: number = 0;
  private consecutiveWins: number = 0;
  private inDrawdownRecovery: boolean = false;
  private pausedUntil: number = 0;
  private sizeMultiplier: number = 1.0;

  private static readonly KELLY_SAFETY_FRACTION = 0.25;
  private static readonly MIN_TRADES_FOR_KELLY = 50;
  private static readonly DEFAULT_WIN_RATE = 0.40;
  private static readonly DEFAULT_AVG_WIN = 2.0;
  private static readonly DEFAULT_AVG_LOSS = 0.8;

  constructor(config: AppConfig, exposureTracker: ExposureTracker) {
    this.maxPositionSizeSol = config.trading.maxPositionSizeSol;
    this.totalCapitalSol = config.trading.totalCapitalSol;
    this.exposureTracker = exposureTracker;
    this.tierConfig = getTierConfig(config.trading.strategyTier);
  }

  calculatePositionSize(
    confidence: number,
    tradeHistory?: TradeHistory,
    atrPercent?: number,
  ): number {
    if (this.isPaused()) {
      logger.info('PositionSizer: trading paused due to consecutive losses');
      return 0;
    }

    const clampedConfidence = Math.max(0, Math.min(1, confidence));
    const entryScore = clampedConfidence * 100;
    const cfg = this.tierConfig.sizing;

    let baseSizeSol: number;
    if (tradeHistory && tradeHistory.totalTrades >= PositionSizer.MIN_TRADES_FOR_KELLY) {
      baseSizeSol = this.kellySize(tradeHistory);
    } else {
      baseSizeSol = this.fixedFractionSize();
    }

    if (entryScore >= cfg.highConvictionThreshold) {
      baseSizeSol *= cfg.highConvictionMultiplier;
    } else if (entryScore < 60 && entryScore >= cfg.lowConvictionMinScore) {
      baseSizeSol *= cfg.lowConvictionMultiplier;
    }

    if (atrPercent !== undefined && atrPercent > 0) {
      baseSizeSol = this.volatilityAdjust(baseSizeSol, atrPercent);
    }

    baseSizeSol *= this.sizeMultiplier;

    baseSizeSol = Math.max(cfg.minPositionSol, baseSizeSol);
    baseSizeSol = Math.min(
      this.maxPositionSizeSol,
      this.totalCapitalSol * (cfg.maxSinglePositionPercent / 100),
      baseSizeSol,
    );

    const available = this.exposureTracker.getAvailableCapital();
    if (baseSizeSol > available) {
      baseSizeSol = available;
    }

    if (baseSizeSol < cfg.minPositionSol) {
      logger.debug('PositionSizer: size below minimum after adjustments', {
        calculatedSize: baseSizeSol,
        minSize: cfg.minPositionSol,
      });
      return 0;
    }

    logger.debug('PositionSizer: size calculated', {
      confidence: clampedConfidence,
      baseSizeSol,
      sizeMultiplier: this.sizeMultiplier,
      consecutiveLosses: this.consecutiveLosses,
      kellyMode: tradeHistory !== undefined && tradeHistory.totalTrades >= PositionSizer.MIN_TRADES_FOR_KELLY,
    });

    return Math.round(baseSizeSol * 1_000_000_000) / 1_000_000_000;
  }

  private kellySize(history: TradeHistory): number {
    const winRate = history.winRate;
    const avgWin = history.avgWinPercent / 100;
    const avgLoss = history.avgLossPercent / 100;

    if (avgWin <= 0) return this.fixedFractionSize();

    const kellyFraction = ((winRate * avgWin) - ((1 - winRate) * avgLoss)) / avgWin;

    if (kellyFraction <= 0) {
      logger.debug('PositionSizer: negative Kelly — edge is zero or negative', {
        kellyFraction,
        winRate,
        avgWin,
        avgLoss,
      });
      return this.fixedFractionSize() * 0.5;
    }

    const safeFraction = kellyFraction * PositionSizer.KELLY_SAFETY_FRACTION;
    const sizeSol = this.totalCapitalSol * safeFraction;

    logger.debug('PositionSizer: Kelly sizing', {
      kellyFull: (kellyFraction * 100).toFixed(2) + '%',
      kellySafe: (safeFraction * 100).toFixed(2) + '%',
      sizeSol: sizeSol.toFixed(4),
    });

    return sizeSol;
  }

  private fixedFractionSize(): number {
    return this.totalCapitalSol * (this.tierConfig.sizing.basePositionPercent / 100);
  }

  private volatilityAdjust(baseSize: number, atrPercent: number): number {
    const targetRisk = 0.02;
    if (atrPercent <= 0) return baseSize;
    const factor = targetRisk / (atrPercent / 100);
    const adjusted = baseSize * Math.min(factor, 2.0);

    logger.debug('PositionSizer: volatility adjustment', {
      atrPercent,
      factor: factor.toFixed(4),
      before: baseSize.toFixed(4),
      after: adjusted.toFixed(4),
    });

    return adjusted;
  }

  recordTradeResult(won: boolean): void {
    if (won) {
      this.consecutiveWins++;
      this.consecutiveLosses = 0;

      if (this.inDrawdownRecovery) {
        if (this.consecutiveWins >= CONSECUTIVE_LOSS_RULES.recoverTo75AfterWins && this.sizeMultiplier < 0.75) {
          this.sizeMultiplier = 0.75;
          logger.info('PositionSizer: recovering — size restored to 75%');
        }
        if (this.consecutiveWins >= CONSECUTIVE_LOSS_RULES.fullRecoverAfterWins) {
          this.sizeMultiplier = 1.0;
          this.inDrawdownRecovery = false;
          logger.info('PositionSizer: full recovery — size restored to 100%');
        }
      }
    } else {
      this.consecutiveLosses++;
      this.consecutiveWins = 0;

      if (this.consecutiveLosses >= CONSECUTIVE_LOSS_RULES.pauseAtLosses) {
        this.pausedUntil = Date.now() + CONSECUTIVE_LOSS_RULES.pauseDurationMs;
        this.sizeMultiplier = 0.25;
        this.inDrawdownRecovery = true;
        logger.warn('PositionSizer: 5+ consecutive losses — PAUSED for 1 hour', {
          pausedUntil: new Date(this.pausedUntil).toISOString(),
        });
      } else if (this.consecutiveLosses >= CONSECUTIVE_LOSS_RULES.reduceTo25AtLosses) {
        this.sizeMultiplier = 0.25;
        this.inDrawdownRecovery = true;
        logger.warn('PositionSizer: 4 consecutive losses — size reduced to 25%');
      } else if (this.consecutiveLosses >= CONSECUTIVE_LOSS_RULES.reduceTo50AtLosses) {
        this.sizeMultiplier = 0.50;
        this.inDrawdownRecovery = true;
        logger.warn('PositionSizer: 3 consecutive losses — size reduced to 50%');
      }
    }
  }

  isPaused(): boolean {
    if (this.pausedUntil > 0 && Date.now() < this.pausedUntil) {
      return true;
    }
    if (this.pausedUntil > 0 && Date.now() >= this.pausedUntil) {
      this.pausedUntil = 0;
      logger.info('PositionSizer: pause expired — trading resumed');
    }
    return false;
  }

  getConsecutiveLosses(): number {
    return this.consecutiveLosses;
  }

  getSizeMultiplier(): number {
    return this.sizeMultiplier;
  }
}
