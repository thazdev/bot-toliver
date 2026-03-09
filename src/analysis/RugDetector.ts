import { logger } from '../utils/logger.js';
import { RUG_SCORE_RULES, RUG_MONITOR_INTERVAL_MS } from '../strategies/config.js';
import { CacheService } from '../core/cache/CacheService.js';
import type { TokenInfo } from '../types/token.types.js';

export interface RugAssessment {
  score: number;
  safe: boolean;
  elevated: boolean;
  reject: boolean;
  reasons: string[];
  sizeMultiplier: number;
  adjustedStopPercent: number | null;
}

export interface LpLockStatus {
  isLocked: boolean;
  isBurned: boolean;
  lockDurationMonths: number;
  lockerProgram: string | null;
}

export interface TokenSafetyInput {
  tokenInfo: TokenInfo;
  lpLockStatus: LpLockStatus;
  devHoldsPercent: number;
  contractVerified: boolean;
  poolSol: number;
  tokenAgeSec: number;
  devWalletAddress: string;
}

export interface RugMonitorState {
  tokenMint: string;
  previousLiquiditySol: number;
  previousDevBalance: number;
  lastCheckAt: number;
  intervalHandle: ReturnType<typeof setInterval> | null;
}

const BURN_ADDRESSES = [
  '1nc1nerator11111111111111111111111111111111',
  '11111111111111111111111111111111',
];

export class RugDetector {
  private cacheService: CacheService;
  private monitors: Map<string, RugMonitorState> = new Map();
  private knownRugDevs: Set<string> = new Set();

  constructor() {
    this.cacheService = new CacheService();
  }

  async assessPreEntry(input: TokenSafetyInput): Promise<RugAssessment> {
    const reasons: string[] = [];
    let score: number = RUG_SCORE_RULES.baseScore;

    if (await this.isKnownRugDev(input.devWalletAddress)) {
      score += RUG_SCORE_RULES.devRugHistoryPenalty;
      reasons.push(`Dev wallet has prior rug history (${RUG_SCORE_RULES.devRugHistoryPenalty})`);
    }

    if (!input.tokenInfo.hasMintAuthority) {
      score += RUG_SCORE_RULES.mintAuthorityBurned;
      reasons.push(`Mint authority burned (+${RUG_SCORE_RULES.mintAuthorityBurned})`);
    }

    if (!input.tokenInfo.hasFreezable) {
      score += RUG_SCORE_RULES.freezeAuthorityAbsent;
      reasons.push(`Freeze authority absent (+${RUG_SCORE_RULES.freezeAuthorityAbsent})`);
    }

    if (input.lpLockStatus.isBurned) {
      score += RUG_SCORE_RULES.lpTokensBurned;
      reasons.push(`LP tokens burned (+${RUG_SCORE_RULES.lpTokensBurned})`);
    } else if (input.lpLockStatus.isLocked && input.lpLockStatus.lockDurationMonths >= 6) {
      score += RUG_SCORE_RULES.lpTokensLocked6m;
      reasons.push(`LP locked ≥6 months (+${RUG_SCORE_RULES.lpTokensLocked6m})`);
    } else {
      score += RUG_SCORE_RULES.lpNotLockedPenalty;
      reasons.push(`LP not locked or burned (${RUG_SCORE_RULES.lpNotLockedPenalty})`);
    }

    if (input.devHoldsPercent > 10) {
      score += RUG_SCORE_RULES.devHoldsOver10Percent;
      reasons.push(`Dev holds ${input.devHoldsPercent.toFixed(1)}% supply (${RUG_SCORE_RULES.devHoldsOver10Percent})`);
    }

    if (input.contractVerified) {
      score += RUG_SCORE_RULES.contractVerified;
      reasons.push(`Contract verified (+${RUG_SCORE_RULES.contractVerified})`);
    }

    if (input.tokenAgeSec < RUG_SCORE_RULES.tokenTooYoungAgeSec) {
      score += RUG_SCORE_RULES.tokenTooYoung;
      reasons.push(`Token < ${RUG_SCORE_RULES.tokenTooYoungAgeSec}s old (${RUG_SCORE_RULES.tokenTooYoung})`);
    }

    if (input.poolSol >= 10) {
      score += RUG_SCORE_RULES.poolAbove10Sol;
      reasons.push(`Pool ≥ 10 SOL (+${RUG_SCORE_RULES.poolAbove10Sol})`);
    } else if (input.poolSol < 2) {
      score += RUG_SCORE_RULES.poolBelow2Sol;
      reasons.push(`Pool < 2 SOL (${RUG_SCORE_RULES.poolBelow2Sol})`);
    }

    score = Math.max(0, Math.min(100, score));

    const safe = score >= RUG_SCORE_RULES.safeThreshold;
    const elevated = score >= RUG_SCORE_RULES.elevatedRiskMin && score < RUG_SCORE_RULES.safeThreshold;
    const reject = score < RUG_SCORE_RULES.rejectThreshold;

    let sizeMultiplier = 1.0;
    let adjustedStopPercent: number | null = null;

    if (elevated) {
      sizeMultiplier = RUG_SCORE_RULES.elevatedRiskSizeMultiplier;
      adjustedStopPercent = RUG_SCORE_RULES.elevatedRiskStopPercent;
    }

    logger.debug('RugDetector: assessment complete', {
      token: input.tokenInfo.mintAddress,
      score,
      safe,
      elevated,
      reject,
      reasons: reasons.length,
    });

    return { score, safe, elevated, reject, reasons, sizeMultiplier, adjustedStopPercent };
  }

  static isLpBurned(ownerAddress: string): boolean {
    return BURN_ADDRESSES.includes(ownerAddress);
  }

  static buildLpLockStatus(
    ownerAddress: string,
    isLockerProgram: boolean,
    lockDurationMonths: number,
  ): LpLockStatus {
    const isBurned = RugDetector.isLpBurned(ownerAddress);
    return {
      isLocked: isLockerProgram || isBurned,
      isBurned,
      lockDurationMonths: isBurned ? 999 : lockDurationMonths,
      lockerProgram: isLockerProgram ? ownerAddress : null,
    };
  }

  startMonitoring(
    tokenMint: string,
    initialLiquiditySol: number,
    initialDevBalance: number,
    onAlert: (type: string, data: Record<string, unknown>) => void,
  ): void {
    if (this.monitors.has(tokenMint)) return;

    const state: RugMonitorState = {
      tokenMint,
      previousLiquiditySol: initialLiquiditySol,
      previousDevBalance: initialDevBalance,
      lastCheckAt: Date.now(),
      intervalHandle: null,
    };

    state.intervalHandle = setInterval(() => {
      this.runMonitorCheck(state, onAlert);
    }, RUG_MONITOR_INTERVAL_MS);

    this.monitors.set(tokenMint, state);
    logger.debug('RugDetector: monitoring started', { tokenMint });
  }

  stopMonitoring(tokenMint: string): void {
    const state = this.monitors.get(tokenMint);
    if (state?.intervalHandle) {
      clearInterval(state.intervalHandle);
    }
    this.monitors.delete(tokenMint);
  }

  stopAllMonitoring(): void {
    for (const [mint] of this.monitors) {
      this.stopMonitoring(mint);
    }
  }

  updateMonitorData(
    tokenMint: string,
    currentLiquiditySol: number,
    currentDevBalance: number,
  ): void {
    const state = this.monitors.get(tokenMint);
    if (!state) return;

    state.previousLiquiditySol = currentLiquiditySol;
    state.previousDevBalance = currentDevBalance;
    state.lastCheckAt = Date.now();
  }

  private runMonitorCheck(
    state: RugMonitorState,
    onAlert: (type: string, data: Record<string, unknown>) => void,
  ): void {
    // The actual liquidity and dev balance fetching is done externally;
    // this is the check logic that gets called with current values via updateMonitorData + check
  }

  checkLiquidityDrop(
    tokenMint: string,
    currentLiquiditySol: number,
  ): { rugDetected: boolean; dropPercent: number } {
    const state = this.monitors.get(tokenMint);
    if (!state || state.previousLiquiditySol <= 0) {
      return { rugDetected: false, dropPercent: 0 };
    }

    const dropPercent = ((state.previousLiquiditySol - currentLiquiditySol) / state.previousLiquiditySol) * 100;

    if (dropPercent >= 15) {
      logger.warn('RugDetector: liquidity drop > 15% detected', {
        tokenMint,
        previous: state.previousLiquiditySol,
        current: currentLiquiditySol,
        dropPercent: dropPercent.toFixed(1),
      });
      return { rugDetected: true, dropPercent };
    }

    return { rugDetected: false, dropPercent };
  }

  checkDevSelling(tokenMint: string, currentDevBalance: number): boolean {
    const state = this.monitors.get(tokenMint);
    if (!state) return false;

    if (currentDevBalance < state.previousDevBalance) {
      logger.warn('RugDetector: dev wallet balance decreased', {
        tokenMint,
        previous: state.previousDevBalance,
        current: currentDevBalance,
      });
      return true;
    }
    return false;
  }

  async addKnownRugDev(walletAddress: string): Promise<void> {
    this.knownRugDevs.add(walletAddress);
    try {
      const key = CacheService.buildKey('rug_dev', walletAddress);
      await this.cacheService.set(key, { flaggedAt: Date.now() }, 86400);
    } catch { /* cache failure is non-critical */ }
  }

  async isKnownRugDev(walletAddress: string): Promise<boolean> {
    if (this.knownRugDevs.has(walletAddress)) return true;
    try {
      const key = CacheService.buildKey('rug_dev', walletAddress);
      const cached = await this.cacheService.get(key);
      if (cached) {
        this.knownRugDevs.add(walletAddress);
        return true;
      }
    } catch { /* cache failure is non-critical */ }
    return false;
  }
}
