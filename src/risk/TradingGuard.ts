import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import { TRADING_GUARD_RULES } from '../strategies/config.js';
import type { StrategyContext, TradingGuardStatus } from '../types/strategy.types.js';

const TOKEN_CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.TOKEN_CIRCUIT_BREAKER_THRESHOLD ?? '3', 10);
const CIRCUIT_BREAKER_RESET_MINUTES = parseInt(process.env.CIRCUIT_BREAKER_RESET_MINUTES ?? '30', 10);

interface TokenBlacklistEntry {
  tokenMint: string;
  reason: string;
  permanent: boolean;
  expiresAt: number;
}

export class TradingGuard {
  private tokenBlacklist: Map<string, TokenBlacklistEntry> = new Map();
  private stoppedOutTokens: Map<string, number> = new Map();
  private sessionBlacklist: Set<string> = new Set();
  private lowWinRatePauseUntil: number = 0;
  private emergencyHalt: boolean = false;
  private tokenFailures: Map<string, number> = new Map();
  private circuitBreakerBlacklist: Set<string> = new Set();
  private circuitBreakerResetInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.circuitBreakerResetInterval = setInterval(() => {
      if (this.tokenFailures.size > 0) {
        logger.info('TradingGuard: circuit breaker reset — clearing token failure counts', {
          tokensCleared: this.tokenFailures.size,
        });
        this.tokenFailures.clear();
      }
    }, CIRCUIT_BREAKER_RESET_MINUTES * 60 * 1000);
  }

  recordTokenFailure(tokenMint: string): void {
    const count = (this.tokenFailures.get(tokenMint) ?? 0) + 1;
    this.tokenFailures.set(tokenMint, count);

    if (count >= TOKEN_CIRCUIT_BREAKER_THRESHOLD && !this.circuitBreakerBlacklist.has(tokenMint)) {
      this.circuitBreakerBlacklist.add(tokenMint);
      logger.error(`token_circuit_breaker: ${tokenMint.slice(0, 8)} blocked after ${count} failures`, {
        tokenMint,
        failureCount: count,
        threshold: TOKEN_CIRCUIT_BREAKER_THRESHOLD,
      });
    }
  }

  setEmergencyHalt(halt: boolean): void {
    this.emergencyHalt = halt;
    if (halt) {
      logger.error('TradingGuard: EMERGENCY HALT ACTIVATED — no new entries allowed');
    } else {
      logger.info('TradingGuard: emergency halt deactivated');
    }
  }

  isEmergencyHalted(): boolean {
    return this.emergencyHalt;
  }

  destroy(): void {
    clearInterval(this.circuitBreakerResetInterval);
  }

  evaluate(context: StrategyContext): TradingGuardStatus {
    const hardBlock = this.checkHardBlocks(context);
    if (hardBlock) {
      return {
        canTrade: false,
        hardBlock: true,
        softRestriction: false,
        reason: hardBlock,
        positionSizeMultiplier: 0,
        entryScoreBoost: 0,
      };
    }

    const softResult = this.checkSoftRestrictions(context);
    return softResult;
  }

  evaluateToken(tokenMint: string, context: StrategyContext): TradingGuardStatus {
    const guardStatus = this.evaluate(context);
    if (!guardStatus.canTrade) return guardStatus;

    const tokenBlock = this.checkTokenBlocks(tokenMint, context);
    if (tokenBlock) {
      return {
        canTrade: false,
        hardBlock: true,
        softRestriction: false,
        reason: tokenBlock,
        positionSizeMultiplier: 0,
        entryScoreBoost: 0,
      };
    }

    return guardStatus;
  }

  private checkHardBlocks(context: StrategyContext): string | null {
    if (this.emergencyHalt) {
      return 'Emergency halt active — bot health critical, no new entries';
    }

    const rules = TRADING_GUARD_RULES.hardBlock;

    if (context.dailyLossPercent >= rules.maxDailyLossPercent) {
      logger.error('TradingGuard: HARD BLOCK — daily loss limit', {
        loss: context.dailyLossPercent.toFixed(2),
        max: rules.maxDailyLossPercent,
      });
      return `Daily loss ${context.dailyLossPercent.toFixed(1)}% >= ${rules.maxDailyLossPercent}% — no new entries`;
    }

    if (context.consecutiveLosses >= rules.maxConsecutiveLosses) {
      logger.error('TradingGuard: HARD BLOCK — consecutive losses', {
        losses: context.consecutiveLosses,
        max: rules.maxConsecutiveLosses,
      });
      return `${context.consecutiveLosses} consecutive losses >= ${rules.maxConsecutiveLosses} — halt and review`;
    }

    if (context.solanaTps > 0 && context.solanaTps < rules.minSolanaTps) {
      return `Solana TPS ${context.solanaTps} < ${rules.minSolanaTps} — network congested`;
    }

    if (context.rpcErrorRate5min > rules.maxRpcErrorRate) {
      return `RPC error rate ${context.rpcErrorRate5min.toFixed(1)}% > ${rules.maxRpcErrorRate}% — infrastructure issue`;
    }

    if (context.gasMultiplier > rules.maxGasMultiplier) {
      return `Gas price ${context.gasMultiplier.toFixed(1)}x baseline > ${rules.maxGasMultiplier}x — network attack/congestion`;
    }

    if (context.hotWalletBalance < rules.minHotWalletSol) {
      return `Hot wallet ${context.hotWalletBalance.toFixed(4)} SOL < ${rules.minHotWalletSol} SOL — insufficient gas`;
    }

    if (!context.jupiterAvailable) {
      return 'Jupiter API unavailable — cannot execute trades safely';
    }

    if (!context.websocketConnected) {
      return 'WebSocket disconnected > 30s — blind to events';
    }

    if (!context.databaseHealthy) {
      return 'Database write failure — cannot log trades safely';
    }

    if (!context.redisConnected) {
      return 'Redis connection lost — cache/queue unreliable';
    }

    if (Date.now() < this.lowWinRatePauseUntil) {
      const remaining = Math.ceil((this.lowWinRatePauseUntil - Date.now()) / 60_000);
      return `Trading paused for low win rate — ${remaining} min remaining`;
    }

    return null;
  }

  private checkSoftRestrictions(context: StrategyContext): TradingGuardStatus {
    const rules = TRADING_GUARD_RULES.softRestriction;
    let sizeMultiplier = 1.0;
    let scoreBoost = 0;
    const reasons: string[] = [];

    if (context.solPriceChange24h < -rules.solanaDownPercent1h) {
      sizeMultiplier *= rules.softSizeMultiplier;
      reasons.push(`SOL down ${Math.abs(context.solPriceChange24h).toFixed(1)}% — half positions`);
    }

    if (context.btcPriceChange1h < -rules.btcDownPercent1h) {
      sizeMultiplier *= rules.softSizeMultiplier;
      reasons.push(`BTC down ${Math.abs(context.btcPriceChange1h).toFixed(1)}% — reduced activity`);
    }

    if (context.newTokensPerHour > rules.noisyMarketTokensPerHour) {
      scoreBoost += rules.softScoreBoost;
      reasons.push(`${context.newTokensPerHour} tokens/hour — raising thresholds +${rules.softScoreBoost}`);
    }

    if (context.consecutiveLosses >= rules.consecutiveSmallLosses && context.consecutiveLosses < TRADING_GUARD_RULES.hardBlock.maxConsecutiveLosses) {
      sizeMultiplier *= rules.softSizeMultiplier;
      reasons.push(`${context.consecutiveLosses} consecutive losses — half position sizes`);
    }

    if (context.winRateLast20 < rules.minWinRateLast20 && context.winRateLast20 > 0) {
      this.lowWinRatePauseUntil = Date.now() + rules.pauseHoursOnLowWinRate * 60 * 60 * 1000;
      logger.warn('TradingGuard: win rate too low — pausing trading', {
        winRate: context.winRateLast20,
        pauseHours: rules.pauseHoursOnLowWinRate,
      });
      return {
        canTrade: false,
        hardBlock: true,
        softRestriction: false,
        reason: `Win rate ${context.winRateLast20}% < ${rules.minWinRateLast20}% — paused ${rules.pauseHoursOnLowWinRate}h`,
        positionSizeMultiplier: 0,
        entryScoreBoost: 0,
      };
    }

    if (context.knownExploitActive) {
      return {
        canTrade: false,
        hardBlock: true,
        softRestriction: false,
        reason: 'Known exploit active in Raydium/Jupiter — halt until patch confirmed',
        positionSizeMultiplier: 0,
        entryScoreBoost: 0,
      };
    }

    const hasRestrictions = reasons.length > 0;
    return {
      canTrade: true,
      hardBlock: false,
      softRestriction: hasRestrictions,
      reason: hasRestrictions ? reasons.join('; ') : 'All clear',
      positionSizeMultiplier: sizeMultiplier,
      entryScoreBoost: scoreBoost,
    };
  }

  private checkTokenBlocks(tokenMint: string, context: StrategyContext): string | null {
    if (this.circuitBreakerBlacklist.has(tokenMint)) {
      return `Token blocked by circuit breaker after ${TOKEN_CIRCUIT_BREAKER_THRESHOLD}+ failures this session`;
    }

    const entry = this.tokenBlacklist.get(tokenMint);
    if (entry) {
      if (entry.permanent) {
        return `Token permanently blocked: ${entry.reason}`;
      }
      if (Date.now() < entry.expiresAt) {
        return `Token temporarily blocked: ${entry.reason}`;
      }
      this.tokenBlacklist.delete(tokenMint);
    }

    if (this.sessionBlacklist.has(tokenMint)) {
      return 'Token in session blacklist (flashloan manipulation detected)';
    }

    const stoppedOutAt = this.stoppedOutTokens.get(tokenMint);
    if (stoppedOutAt) {
      const cooldown = TRADING_GUARD_RULES.tokenBlacklist.stoppedOutCooldownMs;
      if (Date.now() - stoppedOutAt < cooldown) {
        const hoursLeft = Math.ceil((cooldown - (Date.now() - stoppedOutAt)) / (60 * 60 * 1000));
        return `Token stopped out — ${hoursLeft}h cooldown remaining`;
      }
      this.stoppedOutTokens.delete(tokenMint);
    }

    if (context.safetyData.rugScore < TRADING_GUARD_RULES.tokenBlacklist.minRugScore) {
      this.blacklistToken(tokenMint, 'Rug score below minimum', true);
      return `Rug score ${context.safetyData.rugScore} < ${TRADING_GUARD_RULES.tokenBlacklist.minRugScore} — permanently blocked`;
    }

    if (context.flashloanDetected) {
      this.sessionBlacklist.add(tokenMint);
      return 'Flashloan price manipulation detected — session blacklist';
    }

    return null;
  }

  blacklistToken(tokenMint: string, reason: string, permanent: boolean, durationMs?: number): void {
    this.tokenBlacklist.set(tokenMint, {
      tokenMint,
      reason,
      permanent,
      expiresAt: permanent ? Infinity : Date.now() + (durationMs ?? 0),
    });
    logger.info('TradingGuard: token blacklisted', { tokenMint, reason, permanent });
  }

  recordStoppedOut(tokenMint: string): void {
    this.stoppedOutTokens.set(tokenMint, Date.now());
    logger.info('TradingGuard: token stopped out — 24h cooldown', { tokenMint });
  }

  blacklistDevWallet(devWallet: string, tokenMint: string): void {
    this.blacklistToken(tokenMint, `Same dev wallet as previous rug: ${devWallet.slice(0, 8)}…`, true);
  }

  addToSessionBlacklist(tokenMint: string): void {
    this.sessionBlacklist.add(tokenMint);
  }

  isTokenBlocked(tokenMint: string): boolean {
    if (this.circuitBreakerBlacklist.has(tokenMint)) return true;

    const entry = this.tokenBlacklist.get(tokenMint);
    if (entry) {
      if (entry.permanent) return true;
      if (Date.now() < entry.expiresAt) return true;
      this.tokenBlacklist.delete(tokenMint);
    }
    if (this.sessionBlacklist.has(tokenMint)) return true;
    const stoppedAt = this.stoppedOutTokens.get(tokenMint);
    if (stoppedAt && Date.now() - stoppedAt < TRADING_GUARD_RULES.tokenBlacklist.stoppedOutCooldownMs) {
      return true;
    }
    return false;
  }

  async isTokenBlockedWithRedis(tokenMint: string): Promise<boolean> {
    if (this.isTokenBlocked(tokenMint)) return true;

    try {
      const redis = RedisClient.getInstance().getClient();
      const blocked = await redis.get(`token_blocked:${tokenMint}`);
      return blocked !== null;
    } catch {
      return false;
    }
  }

  resetLowWinRatePause(): void {
    this.lowWinRatePauseUntil = 0;
  }
}
