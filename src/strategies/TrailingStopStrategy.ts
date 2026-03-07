// UPDATED: Confirmation window 15s->8s + wick vs trend detection + ExitDecisionEngine integration - 2026-03-07
import { logger } from '../utils/logger.js';
import { getTierConfig, type TierConfig, type TrailingStopConfig } from './config.js';
import type { EnhancedPosition } from '../types/position.types.js';
import type {
  StrategyContext,
  StrategyTier,
  ExitDecision,
} from '../types/strategy.types.js';

const CONFIRMATION_WINDOW_MS = parseInt(process.env.TRAILING_STOP_CONFIRM_MS ?? '8000', 10);
const CATASTROPHIC_DROP_THRESHOLD = parseFloat(process.env.TRAILING_STOP_CATASTROPHIC_DROP_PCT ?? '30');
const WICK_VOLUME_RATIO_THRESHOLD = parseFloat(process.env.TRAILING_STOP_WICK_VOLUME_RATIO ?? '0.30');

interface PriceTick {
  price: number;
  volume1min: number;
  volumeIncreasingDownward: boolean;
  timestamp: number;
}

interface TrailingState {
  peakPrice: number;
  currentTrailStop: number;
  atr: number;
  lastUpdateMs: number;
  breachStartMs: number | null;
  wickDetectedMs: number | null;
}

export class TrailingStopStrategy {
  private tier: StrategyTier;
  private tierConfig: TierConfig;
  private tsConfig: TrailingStopConfig;
  private states: Map<string, TrailingState> = new Map();
  private priceHistory: Map<string, PriceTick[]> = new Map();

  constructor(tier: StrategyTier) {
    this.tier = tier;
    this.tierConfig = getTierConfig(tier);
    this.tsConfig = this.tierConfig.trailingStop;
  }

  initializePosition(position: EnhancedPosition): void {
    this.states.set(position.id, {
      peakPrice: position.entryPrice,
      currentTrailStop: 0,
      atr: 0,
      lastUpdateMs: Date.now(),
      breachStartMs: null,
      wickDetectedMs: null,
    });
  }

  evaluate(position: EnhancedPosition, context: StrategyContext): ExitDecision {
    const noExit: ExitDecision = { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };

    let state = this.states.get(position.id);
    if (!state) {
      this.initializePosition(position);
      state = this.states.get(position.id)!;
    }

    this.recordTick(position.id, context);

    if (context.currentPrice > state.peakPrice) {
      state.peakPrice = context.currentPrice;
    }

    const pnlPercent = position.entryPrice > 0
      ? ((context.currentPrice - position.entryPrice) / position.entryPrice) * 100
      : 0;

    if (pnlPercent <= 0) {
      state.breachStartMs = null;
      state.wickDetectedMs = null;
      return noExit;
    }

    const shouldUpdate = Date.now() - state.lastUpdateMs >= this.tsConfig.updateIntervalMs;
    if (shouldUpdate) {
      this.updateTrailingStop(position, state, pnlPercent, context);
      state.lastUpdateMs = Date.now();
    }

    if (state.currentTrailStop <= 0) return noExit;

    const catastrophicDrop = this.checkCatastrophicDrop(position.id);
    if (catastrophicDrop) {
      logger.error('TrailingStopStrategy: catastrophic drop >30% — EMERGENCY exit, no wick check', {
        positionId: position.id,
        drop: catastrophicDrop.toFixed(1),
      });
      this.cleanupPosition(position.id);
      return {
        shouldExit: true,
        sellPercent: 100,
        reason: `Catastrophic drop ${catastrophicDrop.toFixed(1)}% — EMERGENCY exit, no wick check`,
        isEmergency: true,
      };
    }

    if (context.currentPrice < state.currentTrailStop) {
      return this.handleBreach(position, context, state);
    }

    state.breachStartMs = null;
    state.wickDetectedMs = null;
    return noExit;
  }

  private updateTrailingStop(
    position: EnhancedPosition,
    state: TrailingState,
    pnlPercent: number,
    context: StrategyContext,
  ): void {
    const atr = this.calculateATR(position.id);
    state.atr = atr;

    const atrTrail = state.peakPrice - (atr * this.tsConfig.atrMultiplier);
    const phaseTrailPct = this.getPhaseTrailPercent(pnlPercent);

    let trailStop: number;
    if (phaseTrailPct <= 0) {
      trailStop = atrTrail;
    } else {
      const phaseTrail = state.peakPrice * (1 - phaseTrailPct / 100);
      trailStop = Math.max(atrTrail, phaseTrail);
    }

    if (trailStop > state.currentTrailStop) {
      state.currentTrailStop = trailStop;
      logger.debug('TrailingStopStrategy: trail updated', {
        positionId: position.id,
        peak: state.peakPrice.toFixed(9),
        trail: trailStop.toFixed(9),
        atr: atr.toFixed(9),
        phasePct: phaseTrailPct,
        pnlPct: pnlPercent.toFixed(1),
      });
    }
  }

  private getPhaseTrailPercent(pnlPercent: number): number {
    const p = this.tsConfig.phaseTrails;
    if (pnlPercent > 500) return p.gainAbove500;
    if (pnlPercent > 300) return p.gain300to500;
    if (pnlPercent > 150) return p.gain150to300;
    if (pnlPercent > 75) return p.gain75to150;
    if (pnlPercent > 30) return p.gain30to75;
    return p.breakEvenToGain30;
  }

  calculateATR(positionId: string): number {
    const ticks = this.priceHistory.get(positionId);
    if (!ticks || ticks.length < 2) return 0;

    const sampleCount = Math.min(this.tsConfig.atrSampleCount, ticks.length - 1);
    const recent = ticks.slice(-sampleCount - 1);

    let totalRange = 0;
    for (let i = 1; i < recent.length; i++) {
      totalRange += Math.abs(recent[i].price - recent[i - 1].price);
    }

    return totalRange / sampleCount;
  }

  private handleBreach(
    position: EnhancedPosition,
    context: StrategyContext,
    state: TrailingState,
  ): ExitDecision {
    const noExit: ExitDecision = { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
    const now = Date.now();

    if (!state.breachStartMs) {
      state.breachStartMs = now;
      logger.debug('TrailingStopStrategy: breach started — waiting for confirmation', {
        positionId: position.id,
        trailStop: state.currentTrailStop.toFixed(9),
        currentPrice: context.currentPrice.toFixed(9),
        confirmWindowMs: CONFIRMATION_WINDOW_MS,
      });
    }

    const breachDuration = now - state.breachStartMs;

    if (breachDuration < CONFIRMATION_WINDOW_MS) {
      return noExit;
    }

    const wickOrTrend = this.isWickOrTrend(position.id, state.breachStartMs);

    if (wickOrTrend === 'wick') {
      logger.info('TrailingStopStrategy: wick_false_trigger — cancelling stop, resetting timer', {
        positionId: position.id,
        currentPrice: context.currentPrice.toFixed(9),
        trailStop: state.currentTrailStop.toFixed(9),
      });
      state.breachStartMs = null;
      state.wickDetectedMs = now;
      return noExit;
    }

    const pnlAtExit = position.entryPrice > 0
      ? ((context.currentPrice - position.entryPrice) / position.entryPrice) * 100
      : 0;

    logger.info('TrailingStopStrategy: trailing stop TRIGGERED (trend confirmed)', {
      positionId: position.id,
      currentPrice: context.currentPrice.toFixed(9),
      trailStop: state.currentTrailStop.toFixed(9),
      peak: state.peakPrice.toFixed(9),
      breachDurationMs: breachDuration,
      wickOrTrend,
      pnlPercent: pnlAtExit.toFixed(2),
    });

    this.cleanupPosition(position.id);

    return {
      shouldExit: true,
      sellPercent: 100,
      reason: `Trailing stop: price ${context.currentPrice.toFixed(9)} < trail ${state.currentTrailStop.toFixed(9)} (breach ${(breachDuration / 1000).toFixed(1)}s, trend confirmed)`,
      isEmergency: false,
    };
  }

  private isWickOrTrend(positionId: string, breachTimestamp: number): 'wick' | 'trend' {
    try {
      const ticks = this.priceHistory.get(positionId);
      if (!ticks || ticks.length < 2) return 'trend';

      const now = Date.now();
      const windowMs = CONFIRMATION_WINDOW_MS;
      const recentTicks = ticks.filter(t => t.timestamp >= breachTimestamp && t.timestamp <= now);

      if (recentTicks.length === 0) return 'trend';

      const avgVolumeRecent = recentTicks.reduce((s, t) => s + t.volume1min, 0) / recentTicks.length;

      const sixtySecAgo = breachTimestamp - 60_000;
      const baselineTicks = ticks.filter(t => t.timestamp >= sixtySecAgo && t.timestamp < breachTimestamp);

      if (baselineTicks.length === 0) {
        logger.debug('TrailingStopStrategy: isWickOrTrend = trend (no baseline data — token < 60s or insufficient ticks)', {
          positionId,
          tickCount: ticks.length,
          breachTimestamp,
        });
        return 'trend';
      }

      const avgVolumeBaseline = baselineTicks.reduce((s, t) => s + t.volume1min, 0) / baselineTicks.length;

      if (avgVolumeBaseline <= 0) return 'trend';

      const volumeRatio = avgVolumeRecent / avgVolumeBaseline;

      if (volumeRatio < WICK_VOLUME_RATIO_THRESHOLD) {
        logger.debug('TrailingStopStrategy: isWickOrTrend = wick (low volume during breach)', {
          positionId,
          volumeRatio: volumeRatio.toFixed(3),
          threshold: WICK_VOLUME_RATIO_THRESHOLD,
        });
        return 'wick';
      }

      logger.debug('TrailingStopStrategy: isWickOrTrend = trend (volume confirms sell pressure)', {
        positionId,
        volumeRatio: volumeRatio.toFixed(3),
      });
      return 'trend';
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TrailingStopStrategy: isWickOrTrend error — defaulting to trend', {
        positionId,
        error: errorMsg,
      });
      return 'trend';
    }
  }

  private checkCatastrophicDrop(positionId: string): number | null {
    const ticks = this.priceHistory.get(positionId);
    if (!ticks || ticks.length < 2) return null;

    const latest = ticks[ticks.length - 1];
    const prev = ticks[ticks.length - 2];
    if (prev.price <= 0) return null;

    const dropPct = ((prev.price - latest.price) / prev.price) * 100;
    if (dropPct >= CATASTROPHIC_DROP_THRESHOLD) {
      return dropPct;
    }

    return null;
  }

  private recordTick(positionId: string, context: StrategyContext): void {
    const ticks = this.priceHistory.get(positionId) ?? [];

    const volumeDown = context.volumeContext.volume1min > context.volumeContext.volume5minAvg &&
      context.currentPrice < (context.price60sAgo || context.currentPrice);

    ticks.push({
      price: context.currentPrice,
      volume1min: context.volumeContext.volume1min,
      volumeIncreasingDownward: volumeDown,
      timestamp: Date.now(),
    });

    const cutoff = Date.now() - 10 * 60 * 1000;
    const filtered = ticks.filter(t => t.timestamp > cutoff);
    this.priceHistory.set(positionId, filtered);
  }

  private cleanupPosition(positionId: string): void {
    this.states.delete(positionId);
    this.priceHistory.delete(positionId);
  }

  getState(positionId: string): TrailingState | undefined {
    return this.states.get(positionId);
  }

  removePosition(positionId: string): void {
    this.cleanupPosition(positionId);
  }
}
