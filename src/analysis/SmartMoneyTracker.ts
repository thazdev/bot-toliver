// UPDATED: Sharpe-like score + maxDrawdown penalty + new SmartScore formula - 2026-03-07
import { logger } from '../utils/logger.js';
import { getTierConfig, type SmartMoneyConfig } from '../strategies/config.js';
import type {
  StrategyTier,
  SmartWalletProfile,
  SmartMoneyTier,
  StrategyContext,
  ExitDecision,
} from '../types/strategy.types.js';

interface WalletTradeRecord {
  tokenMint: string;
  entryPrice: number;
  exitPrice: number;
  entryTimestamp: number;
  tokenAgeAtEntryMin: number;
  profitPercent: number;
}

export class SmartMoneyTracker {
  private config: SmartMoneyConfig;
  private wallets: Map<string, SmartWalletProfile> = new Map();
  private walletTrades: Map<string, WalletTradeRecord[]> = new Map();
  private blacklistedWallets: Set<string> = new Set();
  private candidateWallets: Map<string, { successCount: number; firstSeen: number }> = new Map();

  constructor(tier: StrategyTier) {
    this.config = getTierConfig(tier).smartMoney;
  }

  registerWallet(address: string, tradeHistory: WalletTradeRecord[], portfolioSol: number): void {
    if (this.blacklistedWallets.has(address)) {
      logger.debug('SmartMoneyTracker: wallet is blacklisted', { address: address.slice(0, 8) });
      return;
    }

    this.walletTrades.set(address, tradeHistory);
    const profile = this.scoreWallet(address, tradeHistory, portfolioSol);

    if (profile.smartScore >= this.config.tier2MinScore) {
      this.wallets.set(address, profile);
      logger.debug('SmartMoneyTracker: wallet registered', {
        address: address.slice(0, 8),
        tier: profile.tier,
        score: profile.smartScore.toFixed(1),
        winRate: profile.winRate.toFixed(1),
        sharpeScore: profile.sharpeScore?.toFixed(2) ?? 'n/a',
      });
    }
  }

  scoreWallet(address: string, trades: WalletTradeRecord[], portfolioSol: number): SmartWalletProfile {
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.profitPercent > 0);
    const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;

    const allRois = trades.map(t => t.profitPercent);
    const avgRoi = allRois.length > 0
      ? allRois.reduce((sum, r) => sum + r, 0) / allRois.length
      : 0;

    const roiStdDev = this.calculateStdDev(allRois);

    const maxSingleLoss = allRois.length > 0
      ? Math.abs(Math.min(0, ...allRois))
      : 0;
    const maxSingleLossPercent = maxSingleLoss;

    let sharpeScore = avgRoi / Math.max(roiStdDev, 1);

    if (maxSingleLossPercent > 80) {
      sharpeScore *= 0.5;
    } else if (maxSingleLossPercent > 60) {
      sharpeScore *= 0.7;
    } else if (maxSingleLossPercent > 40) {
      sharpeScore *= 0.9;
    }

    const sharpeNormalized = Math.max(0, Math.min(100, sharpeScore * 20));

    const earlyEntries = trades.filter(t => t.tokenAgeAtEntryMin <= this.config.maxBuyTimingMinutes);
    const earlyEntryRate = totalTrades > 0 ? (earlyEntries.length / totalTrades) * 100 : 0;

    const uniqueDays = new Set(trades.map(t => Math.floor(t.entryTimestamp / (24 * 60 * 60 * 1000)))).size;
    const tradesPerDay = uniqueDays > 0 ? totalTrades / uniqueDays : 0;
    const frequencyScore = Math.min(1, tradesPerDay / 5) * 100;

    let maxDrawdownPenaltyScore = 100;
    if (maxSingleLossPercent > 80) {
      maxDrawdownPenaltyScore = 50;
    } else if (maxSingleLossPercent > 60) {
      maxDrawdownPenaltyScore = 70;
    } else if (maxSingleLossPercent > 40) {
      maxDrawdownPenaltyScore = 90;
    }

    const smartScore =
      (winRate * 0.25) +
      (sharpeNormalized * 0.30) +
      (earlyEntryRate * 0.25) +
      (frequencyScore * 0.10) +
      (maxDrawdownPenaltyScore * 0.10);

    let tier: SmartMoneyTier = 'untracked';
    if (smartScore >= this.config.tier1MinScore) tier = 'tier1';
    else if (smartScore >= this.config.tier2MinScore) tier = 'tier2';

    return {
      address,
      tier,
      smartScore,
      winRate,
      avgRoi,
      portfolioSol,
      totalTrades30d: totalTrades,
      earlyEntryRate,
      frequencyScore,
      lastScoreUpdate: Date.now(),
      blacklisted: false,
      roiStdDev,
      maxSingleLoss: maxSingleLossPercent,
      sharpeScore: sharpeNormalized,
    };
  }

  private calculateStdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const squaredDiffs = values.map(v => (v - mean) ** 2);
    const variance = squaredDiffs.reduce((s, d) => s + d, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  evaluateCopyTradeEntry(context: StrategyContext): {
    shouldEnter: boolean;
    sizeMultiplierPct: number;
    reason: string;
  } {
    const tier1Count = context.smartMoneyData.tier1WalletsBuying;
    const tier2Count = context.smartMoneyData.tier2WalletsBuying;

    if (tier1Count <= 0 && tier2Count <= 0) {
      return { shouldEnter: false, sizeMultiplierPct: 0, reason: 'No smart money buying' };
    }

    if (context.safetyData.rugScore < 60) {
      return { shouldEnter: false, sizeMultiplierPct: 0, reason: `Rug score ${context.safetyData.rugScore} < 60 — smart money override blocked` };
    }

    if (tier1Count >= 3) {
      logger.debug('SmartMoneyTracker: 3+ tier-1 wallets buying — BOOST entry', {
        token: context.tokenInfo.mintAddress,
        tier1Count,
      });
      return {
        shouldEnter: true,
        sizeMultiplierPct: this.config.copyTrade3WalletSizePct,
        reason: `${tier1Count} tier-1 smart wallets buying — ${this.config.copyTrade3WalletSizePct}% size`,
      };
    }

    if (tier1Count >= 2) {
      return {
        shouldEnter: true,
        sizeMultiplierPct: this.config.copyTrade2WalletSizePct,
        reason: `${tier1Count} tier-1 smart wallets buying — ${this.config.copyTrade2WalletSizePct}% size`,
      };
    }

    if (tier1Count >= 1) {
      return {
        shouldEnter: true,
        sizeMultiplierPct: this.config.copyTrade1WalletSizePct,
        reason: `${tier1Count} tier-1 smart wallet buying — ${this.config.copyTrade1WalletSizePct}% size`,
      };
    }

    if (tier2Count >= 2) {
      return {
        shouldEnter: true,
        sizeMultiplierPct: this.config.copyTrade1WalletSizePct * 0.7,
        reason: `${tier2Count} tier-2 smart wallets buying — reduced size`,
      };
    }

    return { shouldEnter: false, sizeMultiplierPct: 0, reason: 'Insufficient smart money signal' };
  }

  evaluateSmartExit(context: StrategyContext): ExitDecision {
    const noExit: ExitDecision = { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };

    if (context.smartMoneyData.smartWalletFullExit) {
      logger.warn('SmartMoneyTracker: tier-1 wallet FULL EXIT detected', {
        token: context.tokenInfo.mintAddress,
      });
      return {
        shouldExit: true,
        sellPercent: this.config.followFullExitSellPct,
        reason: `Smart wallet full exit — sell ${this.config.followFullExitSellPct}%`,
        isEmergency: true,
      };
    }

    if (context.smartMoneyData.smartWalletSellingPercent >= this.config.followExitSellThresholdPct) {
      return {
        shouldExit: true,
        sellPercent: this.config.followExitOurSellPct,
        reason: `Smart wallet selling ${context.smartMoneyData.smartWalletSellingPercent.toFixed(0)}% ≥ ${this.config.followExitSellThresholdPct}% — sell ${this.config.followExitOurSellPct}%`,
        isEmergency: false,
      };
    }

    return noExit;
  }

  weeklyRefresh(): void {
    for (const [address, profile] of this.wallets) {
      const trades = this.walletTrades.get(address) ?? [];
      const recentTrades = trades.filter(t => Date.now() - t.entryTimestamp < 30 * 24 * 60 * 60 * 1000);

      if (recentTrades.length === 0) {
        profile.smartScore = Math.max(0, profile.smartScore - this.config.scoreDecayPerWeek);
      } else {
        const refreshed = this.scoreWallet(address, recentTrades, profile.portfolioSol);
        profile.smartScore = refreshed.smartScore;
        profile.winRate = refreshed.winRate;
        profile.avgRoi = refreshed.avgRoi;
        profile.earlyEntryRate = refreshed.earlyEntryRate;
        profile.totalTrades30d = refreshed.totalTrades30d;
        profile.roiStdDev = refreshed.roiStdDev;
        profile.maxSingleLoss = refreshed.maxSingleLoss;
        profile.sharpeScore = refreshed.sharpeScore;
      }

      if (profile.smartScore < this.config.tier2MinScore) {
        this.wallets.delete(address);
        logger.debug('SmartMoneyTracker: wallet removed (score decay)', {
          address: address.slice(0, 8),
          score: profile.smartScore.toFixed(1),
        });
        continue;
      }

      profile.tier = profile.smartScore >= this.config.tier1MinScore ? 'tier1' : 'tier2';
      profile.lastScoreUpdate = Date.now();
    }

    logger.debug('SmartMoneyTracker: weekly refresh complete', {
      totalWallets: this.wallets.size,
      tier1: [...this.wallets.values()].filter(w => w.tier === 'tier1').length,
      tier2: [...this.wallets.values()].filter(w => w.tier === 'tier2').length,
    });
  }

  recalculateAllScores(): void {
    let updated = 0;
    for (const [address, profile] of this.wallets) {
      const trades = this.walletTrades.get(address) ?? [];
      if (trades.length === 0) continue;

      const refreshed = this.scoreWallet(address, trades, profile.portfolioSol);
      profile.smartScore = refreshed.smartScore;
      profile.winRate = refreshed.winRate;
      profile.avgRoi = refreshed.avgRoi;
      profile.earlyEntryRate = refreshed.earlyEntryRate;
      profile.totalTrades30d = refreshed.totalTrades30d;
      profile.roiStdDev = refreshed.roiStdDev;
      profile.maxSingleLoss = refreshed.maxSingleLoss;
      profile.sharpeScore = refreshed.sharpeScore;
      profile.tier = refreshed.tier;
      profile.lastScoreUpdate = Date.now();
      updated++;
    }

    logger.debug('SmartMoneyTracker: full score recalculation complete (Sharpe migration)', {
      walletsUpdated: updated,
      totalWallets: this.wallets.size,
      tier1: [...this.wallets.values()].filter(w => w.tier === 'tier1').length,
      tier2: [...this.wallets.values()].filter(w => w.tier === 'tier2').length,
    });
  }

  recordTokenSuccess(walletAddress: string, multiplier: number): void {
    if (this.wallets.has(walletAddress)) return;

    const candidate = this.candidateWallets.get(walletAddress);
    if (!candidate) {
      this.candidateWallets.set(walletAddress, { successCount: 1, firstSeen: Date.now() });
      return;
    }

    if (multiplier >= this.config.autoDiscoveryMultiplier) {
      candidate.successCount++;
    }

    if (candidate.successCount >= this.config.autoDiscoveryMinTokens) {
      logger.debug('SmartMoneyTracker: auto-discovered smart wallet', {
        address: walletAddress.slice(0, 8),
        successCount: candidate.successCount,
      });
      this.candidateWallets.delete(walletAddress);
    }
  }

  blacklistWallet(address: string, reason: string): void {
    this.blacklistedWallets.add(address);
    this.wallets.delete(address);
    this.walletTrades.delete(address);
    logger.warn('SmartMoneyTracker: wallet BLACKLISTED', {
      address: address.slice(0, 8),
      reason,
    });
  }

  getWallet(address: string): SmartWalletProfile | undefined {
    return this.wallets.get(address);
  }

  getTier1Wallets(): SmartWalletProfile[] {
    return [...this.wallets.values()].filter(w => w.tier === 'tier1');
  }

  getTier2Wallets(): SmartWalletProfile[] {
    return [...this.wallets.values()].filter(w => w.tier === 'tier2');
  }

  getTrackedWalletCount(): number {
    return this.wallets.size;
  }
}
