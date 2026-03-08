import { logger } from '../utils/logger.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { ExposureTracker } from './ExposureTracker.js';
import { PositionManager } from '../positions/PositionManager.js';
import { getTierConfig, type TierConfig } from '../strategies/config.js';
import type { TradeRequest } from '../types/trade.types.js';
import type { AppConfig } from '../types/config.types.js';
import type { MarketRegime, StrategyTier } from '../types/strategy.types.js';

export interface RiskCheckResult {
  approved: boolean;
  reason: string;
}

export class RiskManager {
  private circuitBreaker: CircuitBreaker;
  private exposureTracker: ExposureTracker;
  private positionManager: PositionManager;
  private config: AppConfig;
  private tierConfig: TierConfig;

  private dailyRealizedLoss: number = 0;
  private portfolioValueStart: number;
  private weeklyLoss: number = 0;
  private peakPortfolioValue: number;
  private lastDayReset: number;
  private lastWeekReset: number;

  private lastExitTimestamps: Map<string, number> = new Map();
  private devWalletMap: Map<string, string> = new Map();
  private currentMarketRegime: MarketRegime = 'choppy';
  private activeTier: StrategyTier;
  private newPositionSizeMultiplier: number = 1.0;

  constructor(
    circuitBreaker: CircuitBreaker,
    exposureTracker: ExposureTracker,
    positionManager: PositionManager,
    config: AppConfig,
  ) {
    this.circuitBreaker = circuitBreaker;
    this.exposureTracker = exposureTracker;
    this.positionManager = positionManager;
    this.config = config;
    this.activeTier = config.trading.strategyTier;
    this.tierConfig = getTierConfig(this.activeTier);
    this.portfolioValueStart = config.trading.totalCapitalSol;
    this.peakPortfolioValue = config.trading.totalCapitalSol;
    this.lastDayReset = this.getMidnightUtcMs();
    this.lastWeekReset = this.getWeekStartMs();
  }

  async preTradeCheck(tradeRequest: TradeRequest): Promise<RiskCheckResult> {
    const isDryRun = tradeRequest.dryRun || this.config.bot.dryRun;
    if (isDryRun) {
      return { approved: true, reason: 'DRY_RUN mode active — trade will be simulated' };
    }

    if (this.circuitBreaker.isTripped()) {
      return { approved: false, reason: 'Circuit breaker is tripped — all trading halted' };
    }

    const breakerTripped = await this.circuitBreaker.check();
    if (breakerTripped) {
      return { approved: false, reason: 'Daily loss threshold exceeded — circuit breaker tripped' };
    }

    this.checkResets();

    const riskCfg = this.tierConfig.risk;

    const drawdownPercent = this.getCurrentDrawdownPercent();
    if (drawdownPercent >= riskCfg.maxDrawdownPercent) {
      return { approved: false, reason: `Max drawdown ${drawdownPercent.toFixed(2)}% ≥ ${riskCfg.maxDrawdownPercent}% — trading halted 24h` };
    }

    const weeklyLossPercent = (this.weeklyLoss / this.portfolioValueStart) * 100;
    if (weeklyLossPercent >= riskCfg.maxWeeklyLossPercent) {
      return { approved: false, reason: `Weekly loss ${weeklyLossPercent.toFixed(2)}% ≥ ${riskCfg.maxWeeklyLossPercent}% — full review required` };
    }

    const available = this.exposureTracker.getAvailableCapital();
    if (available < riskCfg.emergencyHaltBalanceSol) {
      return { approved: false, reason: `SOL balance ${available.toFixed(4)} below emergency halt threshold ${riskCfg.emergencyHaltBalanceSol}` };
    }

    const budgetCheck = this.checkDailyRiskBudget();
    if (!budgetCheck.approved) {
      return budgetCheck;
    }

    if (tradeRequest.direction === 'buy') {
      const buyCheck = this.checkBuySpecific(tradeRequest);
      if (!buyCheck.approved) {
        return buyCheck;
      }
    }

    logger.debug('RiskManager: trade approved', {
      tokenMint: tradeRequest.tokenMint,
      direction: tradeRequest.direction,
      amountSol: tradeRequest.amountSol,
      regime: this.currentMarketRegime,
    });

    return { approved: true, reason: 'All risk checks passed' };
  }

  private checkBuySpecific(tradeRequest: TradeRequest): RiskCheckResult {
    const riskCfg = this.tierConfig.risk;

    const openPositions = this.positionManager.getOpenPositions();
    const maxPositions = this.getMaxConcurrentPositions();
    if (openPositions.length >= maxPositions) {
      return { approved: false, reason: `Max open positions reached: ${openPositions.length}/${maxPositions}` };
    }

    const totalExposure = this.exposureTracker.getTotalExposure();
    const maxExposure = this.config.trading.totalCapitalSol * (riskCfg.maxExposurePercent / 100);
    if (totalExposure + tradeRequest.amountSol > maxExposure) {
      return { approved: false, reason: `Total exposure ${(totalExposure + tradeRequest.amountSol).toFixed(4)} SOL would exceed max ${maxExposure.toFixed(4)} SOL (${riskCfg.maxExposurePercent}%)` };
    }

    const totalCapital = this.config.trading.totalCapitalSol;
    const maxSinglePosition = totalCapital * (riskCfg.maxSingleTokenExposurePercent / 100);
    const effectiveSize = tradeRequest.amountSol * this.newPositionSizeMultiplier;
    if (effectiveSize > maxSinglePosition) {
      const availableCapital = this.exposureTracker.getAvailableCapital();
      logger.info('POSITION_SIZE_BLOCKED', {
        calculatedSize: effectiveSize,
        limit: maxSinglePosition,
        limitType: 'maxSingleTokenExposurePercent',
        totalCapitalSol: totalCapital,
        maxSingleTokenExposurePercent: riskCfg.maxSingleTokenExposurePercent,
        availableCapital,
        isDryRun: this.config.bot.dryRun,
        tokenMint: tradeRequest.tokenMint.slice(0, 12),
      });
      return { approved: false, reason: `Position size ${effectiveSize.toFixed(4)} SOL exceeds single token max ${maxSinglePosition.toFixed(4)} SOL (${riskCfg.maxSingleTokenExposurePercent}%)` };
    }

    const availableCapital = this.exposureTracker.getAvailableCapital();
    const availableAfterGas = availableCapital - riskCfg.gasReserveSol;
    if (tradeRequest.amountSol > availableAfterGas) {
      logger.info('POSITION_SIZE_BLOCKED', {
        calculatedSize: tradeRequest.amountSol,
        limit: availableAfterGas,
        limitType: 'availableCapitalAfterGas',
        availableCapital,
        gasReserveSol: riskCfg.gasReserveSol,
        isDryRun: this.config.bot.dryRun,
        tokenMint: tradeRequest.tokenMint.slice(0, 12),
      });
      return { approved: false, reason: `Insufficient capital after gas reserve: ${availableAfterGas.toFixed(4)} SOL available` };
    }

    if (this.positionManager.hasOpenPosition(tradeRequest.tokenMint)) {
      return { approved: false, reason: `Already have an open position for ${tradeRequest.tokenMint}` };
    }

    const lastExit = this.lastExitTimestamps.get(tradeRequest.tokenMint);
    if (lastExit && Date.now() - lastExit < riskCfg.sameTradeCooldownMs) {
      const remaining = Math.ceil((riskCfg.sameTradeCooldownMs - (Date.now() - lastExit)) / 60_000);
      return { approved: false, reason: `Token cooldown: ${remaining} min remaining` };
    }

    const devWallet = this.devWalletMap.get(tradeRequest.tokenMint);
    if (devWallet) {
      const correlatedPositions = openPositions.filter(p => {
        const pDev = this.devWalletMap.get(p.tokenMint);
        return pDev === devWallet;
      });
      if (correlatedPositions.length > 0) {
        return { approved: false, reason: `Correlated token (same dev wallet ${devWallet.slice(0, 8)}…) already has open position` };
      }
    }

    return { approved: true, reason: '' };
  }

  private checkDailyRiskBudget(): RiskCheckResult {
    const riskUsed = this.portfolioValueStart > 0
      ? this.dailyRealizedLoss / this.portfolioValueStart
      : 0;
    const riskCfg = this.tierConfig.risk;

    if (riskUsed >= riskCfg.emergencyExitAtRiskPercent / 100) {
      return { approved: false, reason: `Daily risk ${(riskUsed * 100).toFixed(2)}% ≥ ${riskCfg.emergencyExitAtRiskPercent}% — emergency halt` };
    }

    if (riskUsed >= riskCfg.stopNewTradesAtRiskPercent / 100) {
      return { approved: false, reason: `Daily risk ${(riskUsed * 100).toFixed(2)}% ≥ ${riskCfg.stopNewTradesAtRiskPercent}% — no new trades` };
    }

    if (riskUsed >= riskCfg.reduceSizeAtRiskPercent / 100) {
      this.newPositionSizeMultiplier = 0.5;
      logger.debug('RiskManager: daily risk budget > 3% — new positions at 50% size', { riskUsed: (riskUsed * 100).toFixed(2) });
    } else {
      this.newPositionSizeMultiplier = 1.0;
    }

    return { approved: true, reason: '' };
  }

  recordRealizedLoss(lossSol: number): void {
    if (lossSol > 0) {
      this.dailyRealizedLoss += lossSol;
      this.weeklyLoss += lossSol;
    }
  }

  recordTokenExit(tokenMint: string): void {
    this.lastExitTimestamps.set(tokenMint, Date.now());
  }

  registerDevWallet(tokenMint: string, devWallet: string): void {
    this.devWalletMap.set(tokenMint, devWallet);
  }

  updateMarketRegime(solPriceChange24h: number, networkCongested: boolean): void {
    const previousRegime = this.currentMarketRegime;

    if (networkCongested) {
      this.currentMarketRegime = 'congested';
    } else if (solPriceChange24h > 5) {
      this.currentMarketRegime = 'bull';
    } else if (solPriceChange24h < -5) {
      this.currentMarketRegime = 'bear';
    } else {
      this.currentMarketRegime = 'choppy';
    }

    if (this.currentMarketRegime !== previousRegime) {
      logger.info('RiskManager: market regime changed', {
        from: previousRegime,
        to: this.currentMarketRegime,
        solPriceChange24h,
      });

      this.adjustTierForRegime();
    }
  }

  getMarketRegime(): MarketRegime {
    return this.currentMarketRegime;
  }

  getEffectiveTier(): StrategyTier {
    return this.activeTier;
  }

  updatePortfolioValue(currentValue: number): void {
    if (currentValue > this.peakPortfolioValue) {
      this.peakPortfolioValue = currentValue;
    }
  }

  private adjustTierForRegime(): void {
    const baseTier = this.config.trading.strategyTier;

    switch (this.currentMarketRegime) {
      case 'bull':
        this.activeTier = baseTier;
        break;
      case 'bear':
        this.activeTier = 'conservative';
        break;
      case 'choppy':
        this.activeTier = 'conservative';
        break;
      case 'congested':
        this.activeTier = 'conservative';
        break;
    }

    this.tierConfig = getTierConfig(this.activeTier);

    if (this.currentMarketRegime === 'bear') {
      this.tierConfig = {
        ...this.tierConfig,
        stopLoss: {
          ...this.tierConfig.stopLoss,
          hardStopPercent: this.tierConfig.stopLoss.hardStopPercent * 0.7,
          softWarningPercent: this.tierConfig.stopLoss.softWarningPercent * 0.7,
        },
      };
    }
  }

  private getMaxConcurrentPositions(): number {
    const base = this.tierConfig.sizing.maxConcurrentPositions;
    if (this.currentMarketRegime === 'choppy' || this.currentMarketRegime === 'bear') {
      return Math.max(1, Math.floor(base / 2));
    }
    return base;
  }

  private getCurrentDrawdownPercent(): number {
    if (this.peakPortfolioValue <= 0) return 0;
    const currentValue = this.exposureTracker.getAvailableCapital() + this.exposureTracker.getTotalExposure();
    return ((this.peakPortfolioValue - currentValue) / this.peakPortfolioValue) * 100;
  }

  private checkResets(): void {
    const now = Date.now();
    const midnightUtc = this.getMidnightUtcMs();
    if (midnightUtc > this.lastDayReset) {
      this.dailyRealizedLoss = 0;
      this.lastDayReset = midnightUtc;
      this.portfolioValueStart = this.exposureTracker.getAvailableCapital() + this.exposureTracker.getTotalExposure();
      logger.info('RiskManager: daily risk budget reset at midnight UTC');
    }

    const weekStart = this.getWeekStartMs();
    if (weekStart > this.lastWeekReset) {
      this.weeklyLoss = 0;
      this.lastWeekReset = weekStart;
      logger.info('RiskManager: weekly loss counter reset');
    }
  }

  private getMidnightUtcMs(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  private getWeekStartMs(): number {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff);
  }
}
