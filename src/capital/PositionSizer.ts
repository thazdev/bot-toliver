import { logger } from '../utils/logger.js';
import { ExposureTracker } from '../risk/ExposureTracker.js';
import { getTierConfig, CONSECUTIVE_LOSS_RULES, type TierConfig } from '../strategies/config.js';
import type { AppConfig } from '../types/config.types.js';
import type { StrategyTier } from '../types/strategy.types.js';

/** Mínimo absoluto por trade — abaixo disso fees destroem o lucro (~6.6% round trip). */
export const MINIMUM_TRADE_SIZE_SOL = 0.009;

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

  /** Base = 2% do capital (ex: 0.9 SOL → 0.018 SOL). */
  private static readonly BASE_POSITION_PERCENT = 2;

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
      logger.debug('PositionSizer: trading paused due to consecutive losses');
      return 0;
    }

    const clampedConfidence = Math.max(0, Math.min(1, confidence));
    const entryScore = clampedConfidence * 100;
    const cfg = this.tierConfig.sizing;

    // Base = 2% do capital real (ex: 0.9 SOL → 0.018 SOL)
    const baseSize = this.totalCapitalSol * (PositionSizer.BASE_POSITION_PERCENT / 100);

    // Multiplicador por confiança: score alto 1.5x, médio 1x, baixo 0.5x
    const confidenceMultiplier =
      entryScore >= cfg.highConvictionThreshold
        ? cfg.highConvictionMultiplier
        : entryScore >= 70
          ? 1.0
          : cfg.lowConvictionMultiplier;

    let calculatedSize = baseSize * confidenceMultiplier;
    calculatedSize = Math.min(
      calculatedSize,
      this.maxPositionSizeSol,
      this.totalCapitalSol * (cfg.maxSinglePositionPercent / 100),
    );

    if (atrPercent !== undefined && atrPercent > 0) {
      calculatedSize = this.volatilityAdjust(calculatedSize, atrPercent);
    }

    let finalSize = calculatedSize * this.sizeMultiplier;

    const available = this.exposureTracker.getAvailableCapital();
    finalSize = Math.min(finalSize, available);

    // Nunca abrir trade abaixo do mínimo viável (fees ~6.6%)
    if (finalSize < MINIMUM_TRADE_SIZE_SOL) {
      logger.debug('PositionSizer: size below minimum viable', {
        calculatedSize: finalSize,
        minViable: MINIMUM_TRADE_SIZE_SOL,
      });
      return 0;
    }

    logger.debug('PositionSizer: size calculated', {
      confidence: clampedConfidence,
      baseSize,
      confidenceMultiplier,
      finalSize,
      sizeMultiplier: this.sizeMultiplier,
      consecutiveLosses: this.consecutiveLosses,
    });

    return Math.round(finalSize * 1_000_000_000) / 1_000_000_000;
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
          logger.debug('PositionSizer: recovering — size restored to 75%');
        }
        if (this.consecutiveWins >= CONSECUTIVE_LOSS_RULES.fullRecoverAfterWins) {
          this.sizeMultiplier = 1.0;
          this.inDrawdownRecovery = false;
          logger.debug('PositionSizer: full recovery — size restored to 100%');
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
      logger.debug('PositionSizer: pause expired — trading resumed');
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
