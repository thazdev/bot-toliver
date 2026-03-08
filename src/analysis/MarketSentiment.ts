import { logger } from '../utils/logger.js';
import { getTierConfig, type SentimentConfig } from '../strategies/config.js';
import type {
  StrategyTier,
  SentimentRegime,
  SentimentData,
  TokenSentimentData,
} from '../types/strategy.types.js';

interface SentimentInputs {
  newTokensPerHour: number;
  avgNewTokensPerHour30d: number;
  avgPoolSizeSol: number;
  avgPoolSizeSol30d: number;
  whaleBuysPerHour: number;
  avgWhaleBuysPerHour30d: number;
  rugRateToday: number;
  avgRugRate30d: number;
  profitTakeRateToday: number;
  avgProfitTakeRate30d: number;
  solTransferVolume: number;
  avgSolTransferVolume7d: number;
  newWalletCreationRate: number;
  dexVsCexRatio: number;
  avgTxFee: number;
  failedTxRate: number;
}

export class MarketSentiment {
  private config: SentimentConfig;
  private currentScore: number = 50;
  private currentRegime: SentimentRegime = 'neutral';
  private lastUpdate: number = 0;

  constructor(tier: StrategyTier) {
    this.config = getTierConfig(tier).sentiment;
  }

  computeSentimentScore(inputs: SentimentInputs): SentimentData {
    const newTokenScore = this.scoreNewTokenRate(inputs.newTokensPerHour, inputs.avgNewTokensPerHour30d);
    const poolSizeScore = this.scorePoolSize(inputs.avgPoolSizeSol, inputs.avgPoolSizeSol30d);
    const whaleBuyScore = this.scoreWhaleBuyRate(inputs.whaleBuysPerHour, inputs.avgWhaleBuysPerHour30d);
    const rugRateScore = this.scoreRugRate(inputs.rugRateToday, inputs.avgRugRate30d);
    const profitTakeScore = this.scoreProfitTakeRate(inputs.profitTakeRateToday, inputs.avgProfitTakeRate30d);

    const sentimentScore =
      (newTokenScore * this.config.newTokenRateWeight) +
      (poolSizeScore * this.config.avgPoolSizeWeight) +
      (whaleBuyScore * this.config.whaleBuyRateWeight) +
      (rugRateScore * this.config.rugRateWeight) +
      (profitTakeScore * this.config.profitTakeRateWeight);

    const clamped = Math.max(0, Math.min(100, sentimentScore));
    this.currentScore = clamped;
    this.currentRegime = this.mapRegime(clamped);
    this.lastUpdate = Date.now();

    const solTransferSpike = inputs.avgSolTransferVolume7d > 0
      ? inputs.solTransferVolume / inputs.avgSolTransferVolume7d >= this.config.solTransferSpikeMultiplier
      : false;

    logger.debug('MarketSentiment: score updated', {
      score: clamped.toFixed(1),
      regime: this.currentRegime,
      components: {
        newToken: newTokenScore.toFixed(0),
        poolSize: poolSizeScore.toFixed(0),
        whaleBuy: whaleBuyScore.toFixed(0),
        rugRate: rugRateScore.toFixed(0),
        profitTake: profitTakeScore.toFixed(0),
      },
    });

    return {
      sentimentScore: clamped,
      sentimentRegime: this.currentRegime,
      newTokenRateVsAvg: inputs.avgNewTokensPerHour30d > 0
        ? inputs.newTokensPerHour / inputs.avgNewTokensPerHour30d
        : 1,
      avgPoolSizeVsAvg: inputs.avgPoolSizeSol30d > 0
        ? inputs.avgPoolSizeSol / inputs.avgPoolSizeSol30d
        : 1,
      rugRateToday: inputs.rugRateToday,
      solTransferVolumeSpike: solTransferSpike,
      newWalletCreationRate: inputs.newWalletCreationRate,
      dexVsCexRatio: inputs.dexVsCexRatio,
      avgTxFee: inputs.avgTxFee,
      failedTxRate: inputs.failedTxRate,
    };
  }

  private scoreNewTokenRate(current: number, avg30d: number): number {
    if (avg30d <= 0) return 60;
    const ratio = current / avg30d;
    if (ratio > 2) return 40;
    if (ratio > 1.5) return 55;
    if (ratio > 0.8) return 80;
    if (ratio > 0.5) return 60;
    return 50;
  }

  private scorePoolSize(current: number, avg30d: number): number {
    if (avg30d <= 0) return 50;
    const ratio = current / avg30d;
    if (ratio > 1.5) return 90;
    if (ratio > 1.2) return 75;
    if (ratio > 0.8) return 60;
    if (ratio > 0.5) return 40;
    return 25;
  }

  private scoreWhaleBuyRate(current: number, avg30d: number): number {
    if (avg30d <= 0) return 50;
    const ratio = current / avg30d;
    if (ratio > 2.0) return 95;
    if (ratio > 1.5) return 80;
    if (ratio > 1.0) return 65;
    if (ratio > 0.5) return 45;
    return 30;
  }

  private scoreRugRate(today: number, avg30d: number): number {
    if (avg30d <= 0) return 50;
    const ratio = today / avg30d;
    if (ratio < 0.5) return 90;
    if (ratio < 0.8) return 75;
    if (ratio < 1.2) return 55;
    if (ratio < 1.5) return 35;
    return 15;
  }

  private scoreProfitTakeRate(today: number, avg30d: number): number {
    if (avg30d <= 0) return 50;
    const ratio = today / avg30d;
    if (ratio > 1.5) return 40;
    if (ratio > 1.0) return 60;
    if (ratio > 0.5) return 80;
    return 70;
  }

  mapRegime(score: number): SentimentRegime {
    if (score >= this.config.euphoriaMilestone) return 'euphoria';
    if (score >= this.config.healthyBullMin) return 'healthy_bull';
    if (score >= this.config.neutralMin) return 'neutral';
    if (score >= this.config.bearishMin) return 'bearish';
    return 'panic';
  }

  getRecommendedTier(currentTier: StrategyTier): StrategyTier {
    switch (this.currentRegime) {
      case 'euphoria': return 'aggressive';
      case 'healthy_bull': return currentTier;
      case 'neutral': return 'conservative';
      case 'bearish': return 'conservative';
      case 'panic': return 'conservative';
    }
  }

  getActivityMultiplier(): number {
    switch (this.currentRegime) {
      case 'euphoria': return 1.0;
      case 'healthy_bull': return 1.0;
      case 'neutral': return 0.8;
      case 'bearish': return 0.5;
      case 'panic': return 0;
    }
  }

  shouldSuspendNewEntries(): boolean {
    return this.currentRegime === 'panic';
  }

  computeTokenSentiment(
    holderVelocity: number,
    txFrequency: number,
    avgBuySizeTrend: number,
    recentSellSizes: number[],
    returnBuyerRate: number,
  ): TokenSentimentData {
    let sellDist: TokenSentimentData['sellSizeDistribution'] = 'mixed';
    if (recentSellSizes.length > 0) {
      const avgSell = recentSellSizes.reduce((a, b) => a + b, 0) / recentSellSizes.length;
      const largeSells = recentSellSizes.filter(s => s > avgSell * 2).length;
      const smallSells = recentSellSizes.filter(s => s < avgSell * 0.5).length;

      if (smallSells > recentSellSizes.length * 0.6) sellDist = 'small_retail';
      else if (largeSells > recentSellSizes.length * 0.3) sellDist = 'large_whale';
    }

    return {
      holderCountVelocity: holderVelocity,
      txFrequency,
      avgBuySizeTrend,
      sellSizeDistribution: sellDist,
      returnBuyerRate,
    };
  }

  evaluateNetworkSentiment(
    solTransferVolume: number,
    avgSolTransfer7d: number,
    newWalletsPerDay: number,
    failedTxRate: number,
  ): { bullish: boolean; signals: string[] } {
    const signals: string[] = [];
    let bullishCount = 0;

    if (avgSolTransfer7d > 0 && solTransferVolume / avgSolTransfer7d >= this.config.solTransferSpikeMultiplier) {
      signals.push(`SOL transfer spike: ${(solTransferVolume / avgSolTransfer7d).toFixed(1)}x 7d avg — capital entering`);
      bullishCount++;
    }

    if (newWalletsPerDay > 50_000) {
      signals.push(`${(newWalletsPerDay / 1000).toFixed(0)}K new wallets/day — retail FOMO (late bull signal)`);
      bullishCount++;
    }

    if (failedTxRate > this.config.failedTxRateMax) {
      signals.push(`Failed TX rate ${failedTxRate.toFixed(1)}% > ${this.config.failedTxRateMax}% — congestion, increase slippage`);
    } else if (failedTxRate < 5) {
      signals.push('Low failed TX rate — network healthy');
      bullishCount++;
    }

    return { bullish: bullishCount >= 2, signals };
  }

  getScore(): number {
    return this.currentScore;
  }

  getRegime(): SentimentRegime {
    return this.currentRegime;
  }
}
