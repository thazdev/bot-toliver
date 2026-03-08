import { logger } from '../utils/logger.js';
import { getTierConfig, type TierConfig, type ProfitTakingConfig } from './config.js';
import type { EnhancedPosition } from '../types/position.types.js';
import type {
  StrategyContext,
  StrategyTier,
  ExitDecision,
  ProfitTakeState,
} from '../types/strategy.types.js';

interface PriceSnapshot {
  price: number;
  volume1min: number;
  timestamp: number;
}

export class MultiStageProfitTaker {
  private tier: StrategyTier;
  private tierConfig: TierConfig;
  private profitTakingConfig: ProfitTakingConfig;
  private positionStates: Map<string, ProfitTakeState> = new Map();
  private priceHistory: Map<string, PriceSnapshot[]> = new Map();

  constructor(tier: StrategyTier) {
    this.tier = tier;
    this.tierConfig = getTierConfig(tier);
    this.profitTakingConfig = this.tierConfig.profitTaking;
  }

  evaluate(position: EnhancedPosition, context: StrategyContext): ExitDecision {
    const noExit: ExitDecision = {
      shouldExit: false,
      sellPercent: 0,
      reason: '',
      isEmergency: false,
    };

    this.recordPrice(position.id, context);

    const panicExit = this.checkPanicOverrides(position, context);
    if (panicExit.shouldExit) return panicExit;

    const rugDuringExit = this.checkRugDuringExit(position, context);
    if (rugDuringExit.shouldExit) return rugDuringExit;

    const state = this.getOrInitState(position.id);
    const pnlPercent = this.calculatePnlPercent(position, context);

    const stage4 = this.checkStage4Moonbag(position, context, state, pnlPercent);
    if (stage4.shouldExit) return stage4;

    const stage3 = this.checkStage3(position, context, state, pnlPercent);
    if (stage3.shouldExit) return stage3;

    const stage2 = this.checkStage2(position, context, state, pnlPercent);
    if (stage2.shouldExit) return stage2;

    const stage1 = this.checkStage1(position, context, state, pnlPercent);
    if (stage1.shouldExit) return stage1;

    return noExit;
  }

  private checkStage1(
    position: EnhancedPosition,
    context: StrategyContext,
    state: ProfitTakeState,
    pnlPercent: number,
  ): ExitDecision {
    if (state.stage1Executed) return this.noExit();

    const cfg = this.profitTakingConfig;
    if (pnlPercent < cfg.tp1.gainPercent) return this.noExit();

    const sellPercent = this.capSellToPoolImpact(
      cfg.tp1.sellPercent,
      position,
      context,
    );

    state.stage1Executed = true;
    state.totalSoldPercent += sellPercent;
    state.breakEvenStopActive = true;

    logger.debug('MultiStageProfitTaker: TP1 hit — selling and moving stop to break-even', {
      positionId: position.id,
      pnlPercent: pnlPercent.toFixed(1),
      sellPercent,
      target: cfg.tp1.gainPercent,
    });

    return {
      shouldExit: true,
      sellPercent,
      reason: `TP1: +${pnlPercent.toFixed(1)}% ≥ +${cfg.tp1.gainPercent}% — sell ${sellPercent}%, stop → break-even`,
      isEmergency: false,
    };
  }

  private checkStage2(
    position: EnhancedPosition,
    context: StrategyContext,
    state: ProfitTakeState,
    pnlPercent: number,
  ): ExitDecision {
    if (!state.stage1Executed || state.stage2Executed) return this.noExit();

    const cfg = this.profitTakingConfig;
    if (pnlPercent < cfg.tp2.gainPercent) return this.noExit();

    const remainingPercent = 100 - state.totalSoldPercent;
    const sellOfRemaining = cfg.tp2.sellPercent;
    const effectiveSell = (sellOfRemaining / 100) * remainingPercent;

    const cappedSell = this.capSellToPoolImpact(effectiveSell, position, context);

    state.stage2Executed = true;
    state.totalSoldPercent += cappedSell;
    state.trailingStopActive = true;

    logger.debug('MultiStageProfitTaker: TP2 hit — activating trailing stop', {
      positionId: position.id,
      pnlPercent: pnlPercent.toFixed(1),
      sellPercent: cappedSell.toFixed(1),
      target: cfg.tp2.gainPercent,
    });

    return {
      shouldExit: true,
      sellPercent: Math.round(cappedSell),
      reason: `TP2: +${pnlPercent.toFixed(1)}% ≥ +${cfg.tp2.gainPercent}% — sell ${cappedSell.toFixed(0)}% of remaining, trailing stop active`,
      isEmergency: false,
    };
  }

  private checkStage3(
    position: EnhancedPosition,
    context: StrategyContext,
    state: ProfitTakeState,
    pnlPercent: number,
  ): ExitDecision {
    if (!state.stage2Executed || state.stage3Executed) return this.noExit();

    const cfg = this.profitTakingConfig;
    if (pnlPercent < cfg.tp3.gainPercent) return this.noExit();

    const remainingPercent = 100 - state.totalSoldPercent;
    const sellOfRemaining = cfg.tp3.sellPercent;
    const effectiveSell = (sellOfRemaining / 100) * remainingPercent;

    const isAggressive = this.tier === 'aggressive';
    const moonbagHold = isAggressive ? remainingPercent * 0.30 : 0;
    const actualSell = effectiveSell - moonbagHold;
    const cappedSell = this.capSellToPoolImpact(Math.max(0, actualSell), position, context);

    state.stage3Executed = true;
    state.totalSoldPercent += cappedSell;

    logger.debug('MultiStageProfitTaker: TP3 hit — tightening trail to -10%', {
      positionId: position.id,
      pnlPercent: pnlPercent.toFixed(1),
      sellPercent: cappedSell.toFixed(1),
      target: cfg.tp3.gainPercent,
      moonbagHeld: isAggressive,
    });

    return {
      shouldExit: true,
      sellPercent: Math.round(cappedSell),
      reason: `TP3: +${pnlPercent.toFixed(1)}% ≥ +${cfg.tp3.gainPercent}% — sell ${cappedSell.toFixed(0)}%, trail → -10%`,
      isEmergency: false,
    };
  }

  private checkStage4Moonbag(
    position: EnhancedPosition,
    _context: StrategyContext,
    state: ProfitTakeState,
    pnlPercent: number,
  ): ExitDecision {
    if (!state.stage3Executed || state.stage4Executed) return this.noExit();

    const cfg = this.profitTakingConfig;
    if (pnlPercent < cfg.tp4.gainPercent) return this.noExit();

    const remainingPercent = 100 - state.totalSoldPercent;

    state.stage4Executed = true;
    state.totalSoldPercent = 100;

    logger.debug('MultiStageProfitTaker: TP4 MOONBAG — selling remaining', {
      positionId: position.id,
      pnlPercent: pnlPercent.toFixed(1),
      remainingPercent: remainingPercent.toFixed(1),
    });

    return {
      shouldExit: true,
      sellPercent: Math.round(remainingPercent),
      reason: `TP4 Moonbag: +${pnlPercent.toFixed(1)}% ≥ +${cfg.tp4.gainPercent}% — final exit`,
      isEmergency: false,
    };
  }

  private checkPanicOverrides(
    position: EnhancedPosition,
    context: StrategyContext,
  ): ExitDecision {
    const cfg = this.profitTakingConfig;
    const history = this.priceHistory.get(position.id);

    if (history && history.length >= 2) {
      const now = history[history.length - 1];
      const windowStart = now.timestamp - cfg.panicDropWindowSec * 1000;
      const pastSnapshot = history.find(s => s.timestamp <= windowStart);

      if (pastSnapshot && pastSnapshot.price > 0) {
        const dropPercent = ((pastSnapshot.price - now.price) / pastSnapshot.price) * 100;
        if (dropPercent > cfg.panicDropPercent) {
          logger.error('MultiStageProfitTaker: PANIC EXIT — rapid price drop', {
            positionId: position.id,
            dropPercent: dropPercent.toFixed(1),
            windowSec: cfg.panicDropWindowSec,
          });

          const state = this.getOrInitState(position.id);
          state.totalSoldPercent = 100;

          return {
            shouldExit: true,
            sellPercent: 100,
            reason: `PANIC: price dropped ${dropPercent.toFixed(1)}% in ${cfg.panicDropWindowSec}s — 100% market sell`,
            isEmergency: true,
          };
        }
      }

      const volWindowStart = now.timestamp - cfg.panicVolumeWindowSec * 1000;
      const volSnapshot = history.find(s => s.timestamp <= volWindowStart);

      if (volSnapshot && volSnapshot.volume1min > 0) {
        const volDropPercent = ((volSnapshot.volume1min - now.volume1min) / volSnapshot.volume1min) * 100;
        if (volDropPercent > cfg.panicVolumeDropPercent) {
          logger.error('MultiStageProfitTaker: PANIC EXIT — volume collapse', {
            positionId: position.id,
            volDropPercent: volDropPercent.toFixed(1),
          });

          const state = this.getOrInitState(position.id);
          state.totalSoldPercent = 100;

          return {
            shouldExit: true,
            sellPercent: 100,
            reason: `PANIC: volume dropped ${volDropPercent.toFixed(0)}% in ${cfg.panicVolumeWindowSec}s — liquidity removal suspected`,
            isEmergency: true,
          };
        }
      }
    }

    return this.noExit();
  }

  private checkRugDuringExit(
    position: EnhancedPosition,
    context: StrategyContext,
  ): ExitDecision {
    const state = this.positionStates.get(position.id);
    if (!state || state.totalSoldPercent === 0) return this.noExit();

    const rugIndicators = [
      context.safetyData.devWalletSelling,
      context.safetyData.mintAuthorityReEnabled,
      context.safetyData.liquidityDropPercent60s > 15,
      !context.safetyData.freezeAuthorityAbsent,
    ];

    if (rugIndicators.some(Boolean)) {
      logger.error('MultiStageProfitTaker: RUG during staged exit — aborting stages, selling 100%', {
        positionId: position.id,
        indicators: rugIndicators,
      });

      state.totalSoldPercent = 100;

      return {
        shouldExit: true,
        sellPercent: 100,
        reason: 'RUG indicator fired during staged exit — abort all stages, 100% market sell',
        isEmergency: true,
      };
    }

    return this.noExit();
  }

  private capSellToPoolImpact(
    desiredSellPercent: number,
    position: EnhancedPosition,
    context: StrategyContext,
  ): number {
    if (context.liquidity <= 0) return desiredSellPercent;

    const positionValueSol = position.amountSol * (position.remainingPercent / 100);
    const sellValueSol = positionValueSol * (desiredSellPercent / 100);
    const impactPercent = (sellValueSol / context.liquidity) * 100;
    const maxImpact = this.profitTakingConfig.maxPoolImpactPercent;

    if (impactPercent > maxImpact) {
      const maxSellSol = context.liquidity * (maxImpact / 100);
      const cappedPercent = positionValueSol > 0
        ? (maxSellSol / positionValueSol) * 100
        : desiredSellPercent;
      logger.warn('MultiStageProfitTaker: sell capped to avoid pool impact', {
        desired: desiredSellPercent.toFixed(1),
        capped: cappedPercent.toFixed(1),
        impactPercent: impactPercent.toFixed(2),
      });
      return Math.min(desiredSellPercent, cappedPercent);
    }

    return desiredSellPercent;
  }

  private calculatePnlPercent(position: EnhancedPosition, context: StrategyContext): number {
    if (position.entryPrice <= 0) return 0;
    return ((context.currentPrice - position.entryPrice) / position.entryPrice) * 100;
  }

  private getOrInitState(positionId: string): ProfitTakeState {
    let state = this.positionStates.get(positionId);
    if (!state) {
      state = {
        stage1Executed: false,
        stage2Executed: false,
        stage3Executed: false,
        stage4Executed: false,
        totalSoldPercent: 0,
        breakEvenStopActive: false,
        trailingStopActive: false,
      };
      this.positionStates.set(positionId, state);
    }
    return state;
  }

  private recordPrice(positionId: string, context: StrategyContext): void {
    const history = this.priceHistory.get(positionId) ?? [];
    history.push({
      price: context.currentPrice,
      volume1min: context.volumeContext.volume1min,
      timestamp: Date.now(),
    });

    const cutoff = Date.now() - 5 * 60 * 1000;
    const filtered = history.filter(s => s.timestamp > cutoff);
    this.priceHistory.set(positionId, filtered);
  }

  private noExit(): ExitDecision {
    return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
  }

  getState(positionId: string): ProfitTakeState | undefined {
    return this.positionStates.get(positionId);
  }

  removePosition(positionId: string): void {
    this.positionStates.delete(positionId);
    this.priceHistory.delete(positionId);
  }

  isBreakEvenStopActive(positionId: string): boolean {
    return this.positionStates.get(positionId)?.breakEvenStopActive ?? false;
  }

  isTrailingStopActive(positionId: string): boolean {
    return this.positionStates.get(positionId)?.trailingStopActive ?? false;
  }
}
