/**
 * Early Momentum Entry Strategy
 * Entrada em tokens com forte acumulação inicial antes do pump (EMAS ≥ 75).
 */
import { BaseStrategy } from './BaseStrategy.js';
import { getTierConfig, type TierConfig } from './config.js';
import { logger } from '../utils/logger.js';
import type {
  StrategyContext,
  StrategyResult,
  StrategyTier,
} from '../types/strategy.types.js';

const EMAS_MIN = 55; // Relaxado de 60 — mais tokens passam no early momentum
const POOL_AGE_MIN_SEC = 60;
const POOL_AGE_MAX_SEC = 1800;
const MIN_LIQUIDITY_SOL = 5;
const MIN_RUG_SCORE = 70;
const SIZE_MULTIPLIER = 0.6;

export class EarlyMomentumStrategy extends BaseStrategy {
  readonly name = 'EarlyMomentumStrategy';
  readonly description = 'Early momentum accumulation entry — EMAS ≥ 55, pool 60–1800s, liq ≥ 5 SOL';
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

    const emas = context.earlyMomentumScore ?? 0;
    const trendUp = context.earlyMomentumTrendUp ?? false;
    const prevScore = context.earlyMomentumPrevScore ?? null;

    if (emas < EMAS_MIN) {
      return skip(`EMAS ${emas.toFixed(0)} < ${EMAS_MIN}`);
    }

    if (!trendUp) {
      return skip(`EMAS trend not confirmed (score ${emas.toFixed(0)}, prev ${prevScore ?? 'n/a'})`);
    }

    if (context.poolAgeSec < POOL_AGE_MIN_SEC || context.poolAgeSec > POOL_AGE_MAX_SEC) {
      return skip(
        `Pool age ${context.poolAgeSec.toFixed(0)}s not in range ${POOL_AGE_MIN_SEC}–${POOL_AGE_MAX_SEC}s`,
      );
    }

    if (context.liquidity < MIN_LIQUIDITY_SOL) {
      return skip(`Liquidity ${context.liquidity.toFixed(1)} SOL < ${MIN_LIQUIDITY_SOL} SOL`);
    }

    if (context.safetyData.rugScore < MIN_RUG_SCORE) {
      return skip(`Rug score ${context.safetyData.rugScore} < ${MIN_RUG_SCORE}`);
    }

    const baseSize = this.tierConfig.entry.solSizeMax * SIZE_MULTIPLIER;
    const sizeSol = Math.max(
      this.tierConfig.entry.solSizeMin,
      Math.min(baseSize, this.tierConfig.entry.solSizeMax * SIZE_MULTIPLIER),
    );
    const confidence = emas / 100;

    const prevStr = prevScore !== null ? prevScore.toFixed(0) : 'n/a';
    logger.warn(
      `[EARLY MOMENTUM] Score: ${emas.toFixed(0)} | Prev: ${prevStr} | TrendUp: ${trendUp} → Entry triggered`,
      {
        tokenMint: context.tokenInfo.mintAddress.slice(0, 12),
        emas: emas.toFixed(0),
        prevScore: prevStr,
        trendUp,
        poolAgeSec: context.poolAgeSec,
        liquidity: context.liquidity.toFixed(1),
        rugScore: context.safetyData.rugScore,
      },
    );

    return {
      signal: 'buy',
      confidence,
      reason: `Early momentum: EMAS ${emas.toFixed(0)}/100 — pool ${context.poolAgeSec.toFixed(0)}s, liq ${context.liquidity.toFixed(1)} SOL`,
      suggestedSizeSol: sizeSol,
      triggerType: 'early_momentum',
    };
  }
}
