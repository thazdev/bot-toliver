/**
 * Early Momentum Accumulation Score (EMAS)
 * Detecta tokens em fase inicial de acumulação antes do pump.
 * Score 0–100 baseado em 5 fatores ponderados.
 */
import type { StrategyContext } from '../types/strategy.types.js';

/** Evita ratios artificiais quando volume 5min é muito baixo (USD) */
const MIN_VOLUME_BASELINE_USD = 3000;

/** avgBuySize < ~0.4 SOL (USD) — favorece acumulação distribuída (retail) */
const AVG_BUY_SIZE_RETAIL_THRESHOLD_USD = 60;

export interface EMASBreakdown {
  buyersVelocity: number;
  buyPressure: number;
  smallWalletAccum: number;
  volumeAccel: number;
  holderGrowth: number;
  totalScore: number;
}

/**
 * A) Unique Buyers Velocity (peso 0.25)
 * uniqueBuyersLast2Min / 2 = buyers per minute
 */
function scoreBuyersVelocity(ctx: StrategyContext): number {
  const uniqueBuyers2min = ctx.uniqueBuyers2min ?? 0;
  const buyTxLast60s = ctx.volumeContext.buyTxLast60s;
  const buyersPerMin = uniqueBuyers2min > 0 ? uniqueBuyers2min / 2 : buyTxLast60s;
  if (buyersPerMin >= 8) return 100;
  if (buyersPerMin >= 5) return 80;
  if (buyersPerMin >= 3) return 60;
  return 30;
}

/**
 * B) Buy Pressure (peso 0.25)
 * buyRatio = buys / (buys + sells)
 */
function scoreBuyPressure(ctx: StrategyContext): number {
  const { buyTxLast20, sellTxLast20, buyRatio: ctxBuyRatio } = ctx.volumeContext;
  const total = buyTxLast20 + sellTxLast20;
  const buyRatio = total > 0 ? buyTxLast20 / total : ctxBuyRatio;
  if (buyRatio >= 0.70) return 100;
  if (buyRatio >= 0.60) return 80;
  if (buyRatio >= 0.55) return 60;
  return 30;
}

/**
 * C) Small Wallet Accumulation (peso 0.20)
 * Conta swaps de compra entre 0.02 SOL e 0.30 SOL.
 * Heurística: avgBuySize = volume1min / buys1min (USD) — se < 0.4 SOL equiv → +10 (retail).
 */
function scoreSmallWalletAccum(ctx: StrategyContext): number {
  const buyTxLast20 = ctx.volumeContext.buyTxLast20;
  const avgTradeSize = ctx.volumeContext.avgTradeSize;
  const buyTxLast60s = ctx.volumeContext.buyTxLast60s;
  const volume1min = ctx.volumeContext.volume1min;
  const buys1min = Math.max(buyTxLast60s, 1);
  const avgBuySizeUsd = volume1min / buys1min;

  const smallBuyCount =
    avgTradeSize > 0 && avgTradeSize >= 0.02 && avgTradeSize <= 0.30
      ? buyTxLast20
      : Math.floor(buyTxLast20 * 0.5) || Math.floor(buyTxLast60s * 0.4);

  let score = 30;
  if (smallBuyCount >= 8) score = 100;
  else if (smallBuyCount >= 5) score = 80;
  else if (smallBuyCount >= 3) score = 60;

  if (avgBuySizeUsd < AVG_BUY_SIZE_RETAIL_THRESHOLD_USD) {
    score = Math.min(100, score + 10);
  }
  return score;
}

/**
 * D) Volume Acceleration (peso 0.15)
 * volumeRatio = volume_1m / max(volume_5m, MIN_VOLUME_BASELINE)
 * Evita ratios inflados quando volume 5min é muito baixo.
 */
function scoreVolumeAccel(ctx: StrategyContext): number {
  const { volume1min, volume5minAvg } = ctx.volumeContext;
  const baseline = Math.max(volume5minAvg, MIN_VOLUME_BASELINE_USD);
  const volumeRatio = baseline > 0 ? volume1min / baseline : 0;
  if (volumeRatio >= 2.5) return 100;
  if (volumeRatio >= 2.0) return 80;
  if (volumeRatio >= 1.5) return 60;
  return 30;
}

/**
 * E) Holder Growth (peso 0.15)
 * holders gained per minute
 */
function scoreHolderGrowth(ctx: StrategyContext): number {
  const rate = ctx.holderData.holderGrowthRate;
  if (rate >= 3) return 100;
  if (rate >= 2) return 80;
  if (rate >= 1) return 60;
  return 30;
}

/**
 * Calcula EMAS total (0–100).
 */
export function computeEarlyMomentumScore(ctx: StrategyContext): EMASBreakdown {
  const buyersVelocity = scoreBuyersVelocity(ctx);
  const buyPressure = scoreBuyPressure(ctx);
  const smallWalletAccum = scoreSmallWalletAccum(ctx);
  const volumeAccel = scoreVolumeAccel(ctx);
  const holderGrowth = scoreHolderGrowth(ctx);

  const totalScore =
    buyersVelocity * 0.25 +
    buyPressure * 0.25 +
    smallWalletAccum * 0.20 +
    volumeAccel * 0.15 +
    holderGrowth * 0.15;

  return {
    buyersVelocity,
    buyPressure,
    smallWalletAccum,
    volumeAccel,
    holderGrowth,
    totalScore: Math.max(0, Math.min(100, totalScore)),
  };
}
