import { logger } from '../utils/logger.js';
import { getTierConfig, type WhaleConfig } from '../strategies/config.js';
import type {
  StrategyTier,
  StrategyContext,
  WhaleTransaction,
  WhaleSize,
  WhaleActivityData,
  ExitDecision,
} from '../types/strategy.types.js';

export class WhaleMonitor {
  private config: WhaleConfig;
  private recentTransactions: Map<string, WhaleTransaction[]> = new Map();
  private walletSmartScores: Map<string, number> = new Map();
  private firstBuyers: Map<string, string> = new Map();

  constructor(tier: StrategyTier) {
    this.config = getTierConfig(tier).whale;
  }

  classifyWhaleSize(amountSol: number): WhaleSize | null {
    if (amountSol >= this.config.institutionalMinSol) return 'institutional';
    if (amountSol >= this.config.megaWhaleMinSol) return 'mega';
    if (amountSol >= this.config.whaleMinSol) return 'whale';
    if (amountSol >= this.config.microWhaleMinSol) return 'micro';
    return null;
  }

  recordTransaction(tx: WhaleTransaction): void {
    const key = tx.tokenMint;
    const existing = this.recentTransactions.get(key) ?? [];
    existing.push(tx);

    const cutoff = Date.now() - 30 * 60 * 1000;
    const filtered = existing.filter(t => t.timestamp > cutoff);
    this.recentTransactions.set(key, filtered);

    if (tx.direction === 'buy' && !this.firstBuyers.has(key)) {
      this.firstBuyers.set(key, tx.wallet);
    }

    if (tx.isSmartMoney) {
      this.walletSmartScores.set(tx.wallet, tx.smartScore);
    }
  }

  getWhaleActivity(tokenMint: string): WhaleActivityData {
    const txns = this.recentTransactions.get(tokenMint) ?? [];
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recent = txns.filter(t => t.timestamp > fiveMinAgo);

    const buys = recent.filter(t => t.direction === 'buy');
    const sells = recent.filter(t => t.direction === 'sell');
    const buyWallets = new Set(buys.map(b => b.wallet));
    const sellWallets = new Set(sells.map(s => s.wallet));

    const firstBuyer = this.firstBuyers.get(tokenMint);
    const firstBuyerSelling = firstBuyer ? sellWallets.has(firstBuyer) : false;

    const washDetected = this.detectWashTrades(tokenMint);
    const largestBuy = buys.length > 0 ? Math.max(...buys.map(b => b.amountSol)) : 0;

    let confidenceScore = 0;
    for (const buy of buys) {
      const smartScore = this.walletSmartScores.get(buy.wallet) ?? 0;
      const timeWeight = this.getTimeWeight(buy.timestamp, tokenMint);
      confidenceScore += (smartScore / 100) * (buy.amountSol / Math.max(1, buy.amountSol)) * timeWeight;
    }

    return {
      whaleBuysLast5min: buys.length,
      whaleDistinctBuyers5min: buyWallets.size,
      whaleSellsLast5min: sells.length,
      whaleDistinctSellers5min: sellWallets.size,
      largestWhaleBuySol: largestBuy,
      whaleFirstBuyerSelling: firstBuyerSelling,
      whaleWashTradeDetected: washDetected,
      whaleConfidenceScore: confidenceScore,
    };
  }

  evaluateBuySignal(context: StrategyContext): {
    shouldBoost: boolean;
    scoreBoost: number;
    sizeMultiplier: number;
    tpBoostPct: number;
    reason: string;
  } {
    const whale = context.whaleData;
    const noBoost = { shouldBoost: false, scoreBoost: 0, sizeMultiplier: 1.0, tpBoostPct: 0, reason: '' };

    if (whale.whaleWashTradeDetected) {
      return { ...noBoost, reason: 'Whale wash trading detected — ignoring signal' };
    }

    if (whale.whaleDistinctBuyers5min >= this.config.multiWhaleBuyCount) {
      logger.info('WhaleMonitor: MULTI-WHALE BUY signal', {
        token: context.tokenInfo.mintAddress,
        distinctBuyers: whale.whaleDistinctBuyers5min,
      });
      return {
        shouldBoost: true,
        scoreBoost: this.config.buyScoreBoost * 1.5,
        sizeMultiplier: this.config.multiWhaleSizeMultiplier,
        tpBoostPct: this.config.multiWhaleTpBoostPct,
        reason: `${whale.whaleDistinctBuyers5min} whales buying in 5min — strong signal`,
      };
    }

    if (
      whale.whaleConfidenceScore > 0.5 &&
      context.safetyData.rugScore >= 65 &&
      context.tokenAgeSec < this.config.buySignalMaxTokenAgeMin * 60
    ) {
      return {
        shouldBoost: true,
        scoreBoost: this.config.buyScoreBoost,
        sizeMultiplier: 1.0,
        tpBoostPct: 0,
        reason: `Whale confidence ${whale.whaleConfidenceScore.toFixed(2)} > 0.5 — boost entry score`,
      };
    }

    return noBoost;
  }

  evaluateSellSignal(context: StrategyContext): ExitDecision {
    const noExit: ExitDecision = { shouldExit: false, sellPercent: 0, reason: '', isEmergency: false };
    const whale = context.whaleData;

    if (whale.whaleFirstBuyerSelling) {
      logger.error('WhaleMonitor: FIRST BUYER SELLING — strongest dump signal', {
        token: context.tokenInfo.mintAddress,
      });
      return {
        shouldExit: true,
        sellPercent: this.config.exit3WhalesSellPct,
        reason: 'Whale first-buyer selling — strongest rug/dump signal — EXIT 100%',
        isEmergency: true,
      };
    }

    if (whale.whaleDistinctSellers5min >= 3) {
      logger.error('WhaleMonitor: 3+ whales selling simultaneously — coordinated dump', {
        token: context.tokenInfo.mintAddress,
        sellers: whale.whaleDistinctSellers5min,
      });
      return {
        shouldExit: true,
        sellPercent: this.config.exit3WhalesSellPct,
        reason: `${whale.whaleDistinctSellers5min} whales selling — coordinated dump — EXIT ${this.config.exit3WhalesSellPct}%`,
        isEmergency: true,
      };
    }

    if (whale.whaleDistinctSellers5min >= 2) {
      return {
        shouldExit: true,
        sellPercent: this.config.exit2WhalesSellPct,
        reason: `2 whales selling — sell ${this.config.exit2WhalesSellPct}%`,
        isEmergency: true,
      };
    }

    if (whale.whaleSellsLast5min > 0) {
      const txns = this.recentTransactions.get(context.tokenInfo.mintAddress) ?? [];
      const recentSells = txns.filter(
        t => t.direction === 'sell' && Date.now() - t.timestamp < 5 * 60 * 1000,
      );

      const hasFullExit = recentSells.some(s => s.amountSol >= this.config.whaleMinSol);
      if (hasFullExit) {
        return {
          shouldExit: true,
          sellPercent: this.config.exitSingle100PctSellPct,
          reason: `Whale full exit — sell ${this.config.exitSingle100PctSellPct}% + activate trailing stop`,
          isEmergency: false,
        };
      }

      return {
        shouldExit: true,
        sellPercent: this.config.exitSingle20PctReducePct,
        reason: `Whale partial sell — reduce position by ${this.config.exitSingle20PctReducePct}%`,
        isEmergency: false,
      };
    }

    return noExit;
  }

  private detectWashTrades(tokenMint: string): boolean {
    const txns = this.recentTransactions.get(tokenMint) ?? [];
    const windowMs = this.config.washTradeWindowSec * 1000;

    const walletTxns = new Map<string, WhaleTransaction[]>();
    for (const tx of txns) {
      const existing = walletTxns.get(tx.wallet) ?? [];
      existing.push(tx);
      walletTxns.set(tx.wallet, existing);
    }

    for (const [_wallet, txs] of walletTxns) {
      const buys = txs.filter(t => t.direction === 'buy');
      const sells = txs.filter(t => t.direction === 'sell');

      for (const buy of buys) {
        for (const sell of sells) {
          if (Math.abs(buy.timestamp - sell.timestamp) < windowMs) {
            return true;
          }
          if (buy.amountSol > 0 && Math.abs(buy.amountSol - sell.amountSol) / buy.amountSol < 0.05) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private getTimeWeight(txTimestamp: number, _tokenMint: string): number {
    const ageMs = Date.now() - txTimestamp;
    const ageMin = ageMs / 60_000;
    if (ageMin < 5) return 1.5;
    if (ageMin < 30) return 1.0;
    return 0.7;
  }

  setWalletSmartScore(wallet: string, score: number): void {
    this.walletSmartScores.set(wallet, score);
  }

  clearToken(tokenMint: string): void {
    this.recentTransactions.delete(tokenMint);
    this.firstBuyers.delete(tokenMint);
  }
}
