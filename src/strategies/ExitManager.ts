import { logger } from '../utils/logger.js';
import {
  getTierConfig,
  TIME_EXIT_RULES,
  VOLUME_EXIT_RULES,
  LIQUIDITY_EXIT_RULES,
  type TierConfig,
} from './config.js';
import type { EnhancedPosition } from '../types/position.types.js';
import type {
  StrategyContext,
  StrategyTier,
  ExitDecision,
} from '../types/strategy.types.js';

export class ExitManager {
  private tier: StrategyTier;
  private tierConfig: TierConfig;

  constructor(tier: StrategyTier) {
    this.tier = tier;
    this.tierConfig = getTierConfig(tier);
  }

  evaluate(position: EnhancedPosition, context: StrategyContext): ExitDecision {
    const emergency = this.checkEmergencyExits(position, context);
    if (emergency.shouldExit) return emergency;

    const liquidityExit = this.checkLiquidityExits(context);
    if (liquidityExit.shouldExit) return liquidityExit;

    const volumeExit = this.checkVolumeExits(position, context);
    if (volumeExit.shouldExit) return volumeExit;

    const timeExit = this.checkTimeExits(position);
    if (timeExit.shouldExit) return timeExit;

    const profitExit = this.checkProfitTargets(position, context);
    if (profitExit.shouldExit) return profitExit;

    return { shouldExit: false, sellPercent: 0, reason: 'No exit conditions met', isEmergency: false };
  }

  private checkEmergencyExits(position: EnhancedPosition, context: StrategyContext): ExitDecision {
    if (context.safetyData.devWalletSelling) {
      logger.warn('ExitManager: dev wallet selling detected — emergency exit', {
        tokenMint: position.tokenMint,
      });
      return { shouldExit: true, sellPercent: 100, reason: 'Dev wallet selling tokens', isEmergency: true };
    }

    if (context.safetyData.mintAuthorityReEnabled) {
      return { shouldExit: true, sellPercent: 100, reason: 'Mint authority re-enabled', isEmergency: true };
    }

    if (context.safetyData.txFailureRate30s > 30) {
      return { shouldExit: true, sellPercent: 100, reason: `TX failure rate ${context.safetyData.txFailureRate30s}% > 30%`, isEmergency: true };
    }

    const holderDropRate = this.calculateHolderDropRate(context);
    if (holderDropRate > 20) {
      return { shouldExit: true, sellPercent: 100, reason: `Holder count dropped ${holderDropRate.toFixed(0)}% in 2min`, isEmergency: true };
    }

    return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
  }

  private checkLiquidityExits(context: StrategyContext): ExitDecision {
    const drop60s = context.safetyData.liquidityDropPercent60s;
    const drop10s = context.safetyData.liquidityDropPercent10s;

    if (drop10s >= LIQUIDITY_EXIT_RULES.drop5In10sThreshold) {
      logger.warn('ExitManager: rapid liquidity removal detected', { drop10s });
      return {
        shouldExit: true,
        sellPercent: LIQUIDITY_EXIT_RULES.drop5In10sSellPercent,
        reason: `Liquidity dropped ${drop10s.toFixed(1)}% in 10s — rapid removal`,
        isEmergency: true,
      };
    }

    if (drop60s >= LIQUIDITY_EXIT_RULES.drop20In60sThreshold) {
      return {
        shouldExit: true,
        sellPercent: LIQUIDITY_EXIT_RULES.drop20In60sSellPercent,
        reason: `Liquidity dropped ${drop60s.toFixed(1)}% in 60s — likely rug`,
        isEmergency: true,
      };
    }

    if (drop60s >= LIQUIDITY_EXIT_RULES.drop10In60sThreshold) {
      return {
        shouldExit: true,
        sellPercent: LIQUIDITY_EXIT_RULES.drop10In60sSellPercent,
        reason: `Liquidity dropped ${drop60s.toFixed(1)}% in 60s — monitoring`,
        isEmergency: false,
      };
    }

    return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
  }

  private checkVolumeExits(position: EnhancedPosition, context: StrategyContext): ExitDecision {
    const { volume1min, volume5minAvg, sellVolumeRatio, largestSellPercent } = context.volumeContext;

    if (largestSellPercent >= VOLUME_EXIT_RULES.largeSellThresholdPercent) {
      logger.warn('ExitManager: large sell detected (>1% of pool)', {
        tokenMint: position.tokenMint,
        largestSellPercent,
      });
      return {
        shouldExit: true,
        sellPercent: 100,
        reason: `Large sell detected: ${largestSellPercent.toFixed(2)}% of pool liquidity`,
        isEmergency: true,
      };
    }

    if (sellVolumeRatio > VOLUME_EXIT_RULES.sellVolumeRatioThreshold) {
      return {
        shouldExit: true,
        sellPercent: VOLUME_EXIT_RULES.sellVolumeRatioSellPercent,
        reason: `Sell volume ratio ${(sellVolumeRatio * 100).toFixed(0)}% > ${VOLUME_EXIT_RULES.sellVolumeRatioThreshold * 100}%`,
        isEmergency: false,
      };
    }

    if (volume5minAvg > 0 && volume1min < volume5minAvg * VOLUME_EXIT_RULES.volumeCollapseThreshold) {
      const pnlPercent = position.entryPrice > 0
        ? ((context.currentPrice - position.entryPrice) / position.entryPrice) * 100
        : 0;
      const nearPeak = position.peakPrice > 0
        ? context.currentPrice >= position.peakPrice * 0.9
        : false;

      if (nearPeak) {
        return {
          shouldExit: true,
          sellPercent: 50,
          reason: `Volume collapsing (${(volume1min / volume5minAvg * 100).toFixed(0)}% of avg) while near peak — sell 50%`,
          isEmergency: false,
        };
      }

      if (pnlPercent <= 0) {
        return {
          shouldExit: true,
          sellPercent: 100,
          reason: `Volume collapsing and position underwater — full exit`,
          isEmergency: false,
        };
      }
    }

    return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
  }

  private checkTimeExits(position: EnhancedPosition): ExitDecision {
    const holdTimeMs = Date.now() - position.openedAt.getTime();

    if (holdTimeMs >= TIME_EXIT_RULES.emergencyExitAfterMs) {
      return {
        shouldExit: true,
        sellPercent: 100,
        reason: `Hold time > 4 hours — emergency time exit`,
        isEmergency: true,
      };
    }

    if (holdTimeMs >= TIME_EXIT_RULES.exitAllAfterMs) {
      return {
        shouldExit: true,
        sellPercent: 100,
        reason: `Hold time > 2 hours — mandatory full exit`,
        isEmergency: false,
      };
    }

    if (holdTimeMs >= TIME_EXIT_RULES.sell50AfterMs) {
      return {
        shouldExit: true,
        sellPercent: TIME_EXIT_RULES.sell50Percent,
        reason: `Hold time > 60 min — sell ${TIME_EXIT_RULES.sell50Percent}% of remaining`,
        isEmergency: false,
      };
    }

    if (holdTimeMs >= TIME_EXIT_RULES.sell25AfterMs) {
      return {
        shouldExit: true,
        sellPercent: TIME_EXIT_RULES.sell25Percent,
        reason: `Hold time > 30 min — sell ${TIME_EXIT_RULES.sell25Percent}% of position`,
        isEmergency: false,
      };
    }

    return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
  }

  private checkProfitTargets(position: EnhancedPosition, context: StrategyContext): ExitDecision {
    if (position.entryPrice <= 0) {
      return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
    }

    const rawPnlPercent = ((context.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const adjustedTargets = this.calculateDynamicTargets(context);

    const cfg = this.tierConfig.exit;
    const tranches = position.exitTranches;

    if (rawPnlPercent >= adjustedTargets.tp3 && !tranches[2]?.executed) {
      const sellPercent = cfg.tp3.sellPercent - cfg.residualHoldPercent;
      return {
        shouldExit: true,
        sellPercent: Math.max(0, sellPercent),
        reason: `TP3 hit: ${rawPnlPercent.toFixed(1)}% gain ≥ ${adjustedTargets.tp3.toFixed(1)}% target`,
        isEmergency: false,
      };
    }

    if (rawPnlPercent >= adjustedTargets.tp2 && !tranches[1]?.executed) {
      return {
        shouldExit: true,
        sellPercent: cfg.tp2.sellPercent,
        reason: `TP2 hit: ${rawPnlPercent.toFixed(1)}% gain ≥ ${adjustedTargets.tp2.toFixed(1)}% target`,
        isEmergency: false,
      };
    }

    if (rawPnlPercent >= adjustedTargets.tp1 && !tranches[0]?.executed) {
      return {
        shouldExit: true,
        sellPercent: cfg.tp1.sellPercent,
        reason: `TP1 hit: ${rawPnlPercent.toFixed(1)}% gain ≥ ${adjustedTargets.tp1.toFixed(1)}% target`,
        isEmergency: false,
      };
    }

    return { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
  }

  private calculateDynamicTargets(ctx: StrategyContext): { tp1: number; tp2: number; tp3: number } {
    const cfg = this.tierConfig.exit;

    const avgPrice = ctx.currentPrice > 0 ? ctx.currentPrice : 1;
    const volatilityMultiplier = 1.0 + (ctx.priceStdDev30min / avgPrice);

    const volumeRatio = ctx.volumeContext.volume5minAvg > 0
      ? ctx.volumeContext.volume1min / ctx.volumeContext.volume5minAvg
      : 1;
    const momentumMultiplier = Math.max(0.5, Math.min(2.0, volumeRatio));

    const factor = volatilityMultiplier * momentumMultiplier;

    return {
      tp1: cfg.tp1.gainPercent * factor,
      tp2: cfg.tp2.gainPercent * factor,
      tp3: cfg.tp3.gainPercent * factor,
    };
  }

  private calculateHolderDropRate(ctx: StrategyContext): number {
    if (ctx.holderData.holdersDecreasing) {
      return 25;
    }
    return 0;
  }
}
