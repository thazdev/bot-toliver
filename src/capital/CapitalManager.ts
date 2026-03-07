import { logger } from '../utils/logger.js';
import { getTierConfig, type CapitalConfig } from '../strategies/config.js';
import type { AppConfig } from '../types/config.types.js';

export interface CapitalSnapshot {
  totalCapital: number;
  hotWallet: number;
  reserve: number;
  opportunityReserve: number;
  deployed: number;
  availableForTrading: number;
  needsRebalance: boolean;
}

export class CapitalManager {
  private totalCapital: number;
  private originalCapital: number;
  private allocatedCapital: number = 0;
  private capitalConfig: CapitalConfig;

  private devWalletExposure: Map<string, number> = new Map();
  private sectorExposure: Map<string, number> = new Map();

  private peakCapital: number;
  private lastRebalanceAt: number;

  constructor(config: AppConfig) {
    this.totalCapital = config.trading.totalCapitalSol;
    this.originalCapital = config.trading.totalCapitalSol;
    this.peakCapital = config.trading.totalCapitalSol;
    this.lastRebalanceAt = Date.now();
    this.capitalConfig = getTierConfig(config.trading.strategyTier).capital;
    logger.info('CapitalManager initialized', {
      totalCapitalSol: this.totalCapital,
      hotWallet: this.getHotWalletCapital().toFixed(4),
      reserve: this.getReserveCapital().toFixed(4),
      opportunity: this.getOpportunityReserve().toFixed(4),
    });
  }

  getHotWalletCapital(): number {
    return this.totalCapital * (this.capitalConfig.hotWalletPercent / 100);
  }

  getReserveCapital(): number {
    return this.totalCapital * (this.capitalConfig.reservePercent / 100);
  }

  getOpportunityReserve(): number {
    return this.totalCapital * (this.capitalConfig.opportunityReservePercent / 100);
  }

  getMaxDeployable(): number {
    return this.getHotWalletCapital() * (this.capitalConfig.maxDeployedPercent / 100);
  }

  getMaxPerTrade(): number {
    return this.getHotWalletCapital() * (this.capitalConfig.maxPerTradePercent / 100);
  }

  getMaxPerDevWallet(): number {
    return this.getHotWalletCapital() * (this.capitalConfig.maxPerDevWalletPercent / 100);
  }

  getMaxPerSector(): number {
    return this.getHotWalletCapital() * (this.capitalConfig.maxPerSectorPercent / 100);
  }

  allocateCapital(amount: number, devWallet?: string, sector?: string): boolean {
    if (amount <= 0) return false;

    if (amount < this.capitalConfig.minTradeSizeSol) {
      logger.warn('CapitalManager: trade size below minimum', {
        amount,
        min: this.capitalConfig.minTradeSizeSol,
      });
      return false;
    }

    if (this.allocatedCapital + amount > this.getMaxDeployable()) {
      logger.warn('CapitalManager: would exceed max deployable', {
        requested: amount,
        deployed: this.allocatedCapital,
        maxDeployable: this.getMaxDeployable(),
      });
      return false;
    }

    if (amount > this.getMaxPerTrade()) {
      logger.warn('CapitalManager: exceeds max per trade', {
        amount,
        maxPerTrade: this.getMaxPerTrade(),
      });
      return false;
    }

    if (devWallet) {
      const currentDevExposure = this.devWalletExposure.get(devWallet) ?? 0;
      if (currentDevExposure + amount > this.getMaxPerDevWallet()) {
        logger.warn('CapitalManager: would exceed dev wallet exposure limit', {
          devWallet: devWallet.slice(0, 8),
          current: currentDevExposure,
          requested: amount,
          max: this.getMaxPerDevWallet(),
        });
        return false;
      }
    }

    if (sector) {
      const currentSectorExposure = this.sectorExposure.get(sector) ?? 0;
      if (currentSectorExposure + amount > this.getMaxPerSector()) {
        logger.warn('CapitalManager: would exceed sector exposure limit', {
          sector,
          current: currentSectorExposure,
          requested: amount,
          max: this.getMaxPerSector(),
        });
        return false;
      }
    }

    this.allocatedCapital += amount;
    if (devWallet) {
      this.devWalletExposure.set(devWallet, (this.devWalletExposure.get(devWallet) ?? 0) + amount);
    }
    if (sector) {
      this.sectorExposure.set(sector, (this.sectorExposure.get(sector) ?? 0) + amount);
    }

    logger.debug('Capital allocated', {
      amount,
      totalAllocated: this.allocatedCapital,
      availableHotWallet: this.getAvailableForTrading(),
    });
    return true;
  }

  releaseCapital(amount: number, devWallet?: string, sector?: string): void {
    this.allocatedCapital = Math.max(0, this.allocatedCapital - amount);
    if (devWallet) {
      const current = this.devWalletExposure.get(devWallet) ?? 0;
      const newVal = Math.max(0, current - amount);
      if (newVal <= 0) this.devWalletExposure.delete(devWallet);
      else this.devWalletExposure.set(devWallet, newVal);
    }
    if (sector) {
      const current = this.sectorExposure.get(sector) ?? 0;
      const newVal = Math.max(0, current - amount);
      if (newVal <= 0) this.sectorExposure.delete(sector);
      else this.sectorExposure.set(sector, newVal);
    }
    logger.debug('Capital released', {
      amount,
      totalAllocated: this.allocatedCapital,
      availableHotWallet: this.getAvailableForTrading(),
    });
  }

  getAvailableForTrading(): number {
    return Math.max(0, this.getMaxDeployable() - this.allocatedCapital);
  }

  getAvailableCapital(): number {
    return this.getAvailableForTrading();
  }

  getAllocatedCapital(): number {
    return this.allocatedCapital;
  }

  getTotalCapital(): number {
    return this.totalCapital;
  }

  canUseOpportunityReserve(entryScore: number): boolean {
    return entryScore >= this.capitalConfig.opportunityScoreThreshold;
  }

  getAvailableWithOpportunity(entryScore: number): number {
    let available = this.getAvailableForTrading();
    if (this.canUseOpportunityReserve(entryScore)) {
      available += this.getOpportunityReserve();
    }
    return available;
  }

  calculateCompoundSize(basePct: number): number {
    const rawSize = this.totalCapital * basePct;
    const floor = this.capitalConfig.minTradeSizeSol;
    const cap = this.capitalConfig.compoundGrowthCap;

    const size = Math.max(floor, rawSize);
    if (this.totalCapital < 100) {
      return Math.min(size, cap);
    }
    return size;
  }

  needsRebalance(): boolean {
    const hotWalletActual = this.getHotWalletCapital() - this.allocatedCapital;
    const hotWalletFloor = this.originalCapital * (this.capitalConfig.minHotWalletFloorPercent / 100);

    if (hotWalletActual < hotWalletFloor) return true;

    const drawdownPercent = this.peakCapital > 0
      ? ((this.peakCapital - this.totalCapital) / this.peakCapital) * 100
      : 0;
    if (drawdownPercent >= 15) return true;

    const weekMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - this.lastRebalanceAt >= weekMs) return true;

    return false;
  }

  rebalance(): void {
    logger.info('CapitalManager: rebalancing portfolio buckets', {
      totalCapital: this.totalCapital,
      allocated: this.allocatedCapital,
    });
    this.lastRebalanceAt = Date.now();
  }

  updateTotalCapital(newTotal: number): void {
    this.totalCapital = newTotal;
    if (newTotal > this.peakCapital) {
      this.peakCapital = newTotal;
    }
  }

  getSnapshot(): CapitalSnapshot {
    return {
      totalCapital: this.totalCapital,
      hotWallet: this.getHotWalletCapital(),
      reserve: this.getReserveCapital(),
      opportunityReserve: this.getOpportunityReserve(),
      deployed: this.allocatedCapital,
      availableForTrading: this.getAvailableForTrading(),
      needsRebalance: this.needsRebalance(),
    };
  }
}
