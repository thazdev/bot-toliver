import { logger } from '../utils/logger.js';
import { getTierConfig, type TierConfig } from './config.js';
import type { EnhancedPosition } from '../types/position.types.js';
import type {
  StrategyContext,
  StrategyTier,
  StopLossState,
  StopLossStatus,
  ExitDecision,
} from '../types/strategy.types.js';

export class StopLossManager {
  private tier: StrategyTier;
  private tierConfig: TierConfig;
  private positionStates: Map<string, StopLossStatus> = new Map();
  private blacklist: Map<string, number> = new Map();

  constructor(tier: StrategyTier) {
    this.tier = tier;
    this.tierConfig = getTierConfig(tier);
  }

  initializePosition(position: EnhancedPosition): void {
    const cfg = this.tierConfig.stopLoss;
    const hardStopPrice = position.entryPrice * (1 - cfg.hardStopPercent / 100);

    const status: StopLossStatus = {
      state: 'WATCHING',
      currentStopPrice: hardStopPrice,
      trailingDelta: cfg.trailingStopDelta,
      peakPrice: position.entryPrice,
    };

    this.positionStates.set(position.id, status);

    logger.debug('StopLossManager: initialized position', {
      positionId: position.id,
      state: status.state,
      stopPrice: hardStopPrice.toFixed(9),
      trailingDelta: cfg.trailingStopDelta,
    });
  }

  evaluate(position: EnhancedPosition, context: StrategyContext): ExitDecision {
    const noExit: ExitDecision = { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };

    const eventStop = this.checkEventBasedStops(position, context);
    if (eventStop.shouldExit) {
      this.transitionState(position.id, 'EMERGENCY_EXIT');
      this.blacklistToken(position.tokenMint);
      return eventStop;
    }

    let status = this.positionStates.get(position.id);
    if (!status) {
      this.initializePosition(position);
      status = this.positionStates.get(position.id)!;
    }

    if (context.currentPrice > status.peakPrice) {
      status.peakPrice = context.currentPrice;
    }

    const pnlPercent = position.entryPrice > 0
      ? ((context.currentPrice - position.entryPrice) / position.entryPrice) * 100
      : 0;

    const cfg = this.tierConfig.stopLoss;

    switch (status.state) {
      case 'WATCHING':
        return this.handleWatching(position, context, status, pnlPercent, cfg);
      case 'SOFT_WARNING':
        return this.handleSoftWarning(position, context, status, pnlPercent, cfg);
      case 'BREAK_EVEN_ACTIVE':
        return this.handleBreakEvenActive(position, context, status, cfg);
      case 'HARD_STOP':
        return this.executeHardStop(position);
      case 'EMERGENCY_EXIT':
        return this.executeHardStop(position);
      default:
        return noExit;
    }
  }

  private handleWatching(
    position: EnhancedPosition,
    _context: StrategyContext,
    status: StopLossStatus,
    pnlPercent: number,
    cfg: TierConfig['stopLoss'],
  ): ExitDecision {
    if (pnlPercent >= cfg.breakEvenActivationGain) {
      this.transitionState(position.id, 'BREAK_EVEN_ACTIVE');
      status.currentStopPrice = position.entryPrice * 1.05;
      logger.info('StopLossManager: break-even stop activated', {
        positionId: position.id,
        pnlPercent: pnlPercent.toFixed(2),
        newStop: status.currentStopPrice.toFixed(9),
      });
      return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
    }

    if (pnlPercent <= -cfg.softWarningPercent) {
      this.transitionState(position.id, 'SOFT_WARNING');
      logger.warn('StopLossManager: soft warning triggered', {
        positionId: position.id,
        pnlPercent: pnlPercent.toFixed(2),
        threshold: -cfg.softWarningPercent,
      });
      return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
    }

    return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
  }

  private handleSoftWarning(
    position: EnhancedPosition,
    _context: StrategyContext,
    _status: StopLossStatus,
    pnlPercent: number,
    cfg: TierConfig['stopLoss'],
  ): ExitDecision {
    if (pnlPercent <= -cfg.hardStopPercent) {
      this.transitionState(position.id, 'HARD_STOP');
      return this.executeHardStop(position);
    }

    if (pnlPercent > -cfg.softWarningPercent + 3) {
      this.transitionState(position.id, 'WATCHING');
      logger.info('StopLossManager: recovered from soft warning', {
        positionId: position.id,
        pnlPercent: pnlPercent.toFixed(2),
      });
      return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
    }

    return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
  }

  private handleBreakEvenActive(
    position: EnhancedPosition,
    context: StrategyContext,
    status: StopLossStatus,
    cfg: TierConfig['stopLoss'],
  ): ExitDecision {
    const trailingStop = status.peakPrice * (1 - cfg.trailingStopDelta / 100);
    if (trailingStop > status.currentStopPrice) {
      status.currentStopPrice = trailingStop;
    }

    if (context.currentPrice <= status.currentStopPrice) {
      const trailingPnl = position.entryPrice > 0
        ? ((context.currentPrice - position.entryPrice) / position.entryPrice) * 100
        : 0;

      logger.info('StopLossManager: trailing stop triggered', {
        positionId: position.id,
        currentPrice: context.currentPrice.toFixed(9),
        stopPrice: status.currentStopPrice.toFixed(9),
        peakPrice: status.peakPrice.toFixed(9),
        pnlPercent: trailingPnl.toFixed(2),
      });

      this.transitionState(position.id, 'HARD_STOP');
      return {
        shouldExit: true,
        sellPercent: 100,
        reason: `Trailing stop hit: price ${context.currentPrice.toFixed(9)} <= stop ${status.currentStopPrice.toFixed(9)} (${cfg.trailingStopDelta}% below peak)`,
        isEmergency: false,
      };
    }

    return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
  }

  private executeHardStop(position: EnhancedPosition): ExitDecision {
    logger.warn('StopLossManager: HARD STOP executed', {
      positionId: position.id,
      tokenMint: position.tokenMint,
    });
    this.blacklistToken(position.tokenMint);
    return {
      shouldExit: true,
      sellPercent: 100,
      reason: 'Hard stop loss triggered — 100% market sell',
      isEmergency: true,
    };
  }

  private checkEventBasedStops(position: EnhancedPosition, context: StrategyContext): ExitDecision {
    const noExit: ExitDecision = { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };

    if (context.safetyData.devWalletSelling) {
      return { shouldExit: true, sellPercent: 100, reason: 'Dev wallet selling — event stop', isEmergency: true };
    }

    if (context.safetyData.mintAuthorityReEnabled) {
      return { shouldExit: true, sellPercent: 100, reason: 'Mint authority re-enabled — event stop', isEmergency: true };
    }

    if (context.safetyData.liquidityDropPercent60s > 15) {
      return {
        shouldExit: true,
        sellPercent: 100,
        reason: `Liquidity removed ${context.safetyData.liquidityDropPercent60s.toFixed(1)}% > 15% — event stop`,
        isEmergency: true,
      };
    }

    if (!context.safetyData.freezeAuthorityAbsent) {
      return { shouldExit: true, sellPercent: 100, reason: 'Token freeze instruction detected — event stop', isEmergency: true };
    }

    if (context.safetyData.txFailureRate30s > 30) {
      return {
        shouldExit: true,
        sellPercent: 100,
        reason: `TX failure rate ${context.safetyData.txFailureRate30s}% > 30% — event stop`,
        isEmergency: true,
      };
    }

    if (context.holderData.holdersDecreasing) {
      return { shouldExit: true, sellPercent: 100, reason: 'Holder count dropping > 20% in 2min — event stop', isEmergency: true };
    }

    return noExit;
  }

  estimateSlippageLoss(positionSol: number, poolLiquiditySol: number): number {
    if (poolLiquiditySol <= 0) return 1;
    return (positionSol / poolLiquiditySol) * 1.5;
  }

  calculateExpectedExitPrice(
    triggerPrice: number,
    positionSol: number,
    poolLiquiditySol: number,
  ): number {
    const estimatedSlippage = this.estimateSlippageLoss(positionSol, poolLiquiditySol);
    return triggerPrice * (1 - estimatedSlippage);
  }

  wouldExceedMaxLoss(
    entryPrice: number,
    positionSol: number,
    poolLiquiditySol: number,
    maxLossPercent: number = 35,
  ): boolean {
    const stopPrice = entryPrice * (1 - this.tierConfig.stopLoss.hardStopPercent / 100);
    const expectedExit = this.calculateExpectedExitPrice(stopPrice, positionSol, poolLiquiditySol);
    const expectedLossPercent = ((entryPrice - expectedExit) / entryPrice) * 100;
    return expectedLossPercent > maxLossPercent;
  }

  getState(positionId: string): StopLossStatus | undefined {
    return this.positionStates.get(positionId);
  }

  isBlacklisted(tokenMint: string): boolean {
    const blacklistedAt = this.blacklist.get(tokenMint);
    if (!blacklistedAt) return false;
    const BLACKLIST_DURATION_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - blacklistedAt > BLACKLIST_DURATION_MS) {
      this.blacklist.delete(tokenMint);
      return false;
    }
    return true;
  }

  removePosition(positionId: string): void {
    this.positionStates.delete(positionId);
  }

  private transitionState(positionId: string, newState: StopLossState): void {
    const status = this.positionStates.get(positionId);
    if (status) {
      logger.debug('StopLossManager: state transition', {
        positionId,
        from: status.state,
        to: newState,
      });
      status.state = newState;
    }
  }

  private blacklistToken(tokenMint: string): void {
    this.blacklist.set(tokenMint, Date.now());
    logger.info('StopLossManager: token blacklisted for 24h', { tokenMint });
  }
}
