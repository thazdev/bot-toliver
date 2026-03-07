import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import type { TradingGuard } from '../risk/TradingGuard.js';

const BOT_HEALTH_CHECK_MS = parseInt(process.env.BOT_HEALTH_CHECK_MS ?? '15000', 10);
const HEALTH_WARNING_MS = parseInt(process.env.HEALTH_WARNING_MS ?? '60000', 10);
const HEALTH_CRITICAL_MS = parseInt(process.env.HEALTH_CRITICAL_MS ?? '300000', 10);

export interface HealthStatus {
  healthy: boolean;
  lastEventAgo: number;
  stuckPositions: number;
}

export class BotHealthMonitor {
  private static instance: BotHealthMonitor | null = null;
  private lastEventProcessedAt: number = Date.now();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private tradingGuard: TradingGuard;

  private constructor(tradingGuard: TradingGuard) {
    this.tradingGuard = tradingGuard;
  }

  static initialize(tradingGuard: TradingGuard): BotHealthMonitor {
    if (!BotHealthMonitor.instance) {
      BotHealthMonitor.instance = new BotHealthMonitor(tradingGuard);
    }
    return BotHealthMonitor.instance;
  }

  static getInstance(): BotHealthMonitor {
    if (!BotHealthMonitor.instance) {
      throw new Error('BotHealthMonitor not initialized. Call initialize() first.');
    }
    return BotHealthMonitor.instance;
  }

  static recordEvent(): void {
    if (BotHealthMonitor.instance) {
      BotHealthMonitor.instance.lastEventProcessedAt = Date.now();
    }
  }

  start(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, BOT_HEALTH_CHECK_MS);

    logger.info('BotHealthMonitor: started', {
      checkIntervalMs: BOT_HEALTH_CHECK_MS,
      warningThresholdMs: HEALTH_WARNING_MS,
      criticalThresholdMs: HEALTH_CRITICAL_MS,
    });
  }

  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    BotHealthMonitor.instance = null;
    logger.info('BotHealthMonitor: stopped');
  }

  private performHealthCheck(): void {
    const elapsed = Date.now() - this.lastEventProcessedAt;

    if (elapsed > HEALTH_CRITICAL_MS) {
      logger.error('health_critical: bot may be frozen', {
        lastEventAgoMs: elapsed,
        criticalThresholdMs: HEALTH_CRITICAL_MS,
        action: 'Pausing new entries via emergency halt',
      });
      this.tradingGuard.setEmergencyHalt(true);
      return;
    }

    if (elapsed > HEALTH_WARNING_MS) {
      logger.warn('health_warning: no events processed recently', {
        lastEventAgoMs: elapsed,
        warningThresholdMs: HEALTH_WARNING_MS,
        hint: 'WebSocket may be disconnected or network is slow',
      });
    }
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const lastEventAgo = Date.now() - this.lastEventProcessedAt;

    let stuckPositions = 0;
    try {
      const redis = RedisClient.getInstance().getClient();
      const keys = await redis.keys('stuck_position:*');
      stuckPositions = keys.length;
    } catch {
      // Non-critical: report 0 if Redis is unavailable
    }

    return {
      healthy: lastEventAgo < HEALTH_WARNING_MS,
      lastEventAgo,
      stuckPositions,
    };
  }
}
