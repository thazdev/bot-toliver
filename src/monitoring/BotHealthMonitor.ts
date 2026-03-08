import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import type { TradingGuard } from '../risk/TradingGuard.js';
import { getEffectiveDryRun } from '../config/DryRunResolver.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';
import { loadConfig } from '../config/index.js';

const BOT_HEALTH_CHECK_MS = parseInt(process.env.BOT_HEALTH_CHECK_MS ?? '10000', 10);
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
    this.writeDashboardHeartbeat().catch(() => {});
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, BOT_HEALTH_CHECK_MS);

    logger.debug('BotHealthMonitor: started', {
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
    logger.debug('BotHealthMonitor: stopped');
  }

  private async performHealthCheck(): Promise<void> {
    await this.writeDashboardHeartbeat();

    const enabled = await isBotEnabled();
    if (!enabled) {
      return;
    }

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

  private async writeDashboardHeartbeat(): Promise<void> {
    try {
      const config = loadConfig();
      const [dryRun, enabled] = await Promise.all([getEffectiveDryRun(config), isBotEnabled()]);
      const redis = RedisClient.getInstance().getClient();
      const startTime = (globalThis as { __botStartTime?: number }).__botStartTime ?? Date.now();
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

      const status = !enabled ? 'PAUSED' : dryRun ? 'DRY_RUN' : 'RUNNING';
      const payload = {
        status,
        lastHeartbeat: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        uptimeSeconds,
      };
      await redis.setex('bot_health', 60, JSON.stringify(payload));
    } catch (err) {
      logger.debug('Dashboard heartbeat write failed', { err: String(err) });
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
