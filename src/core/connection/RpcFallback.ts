import { Connection } from '@solana/web3.js';
import { logger } from '../../utils/logger.js';
import { HEALTH_CHECK_INTERVAL_MS } from '../../utils/constants.js';
import { RateLimiter } from './RateLimiter.js';

/**
 * Manages RPC endpoint fallback and health checking.
 * Monitors the primary RPC connection and switches to fallback on failure.
 */
export class RpcFallback {
  private primaryConnection: Connection;
  private fallbackConnection: Connection;
  private activeConnection: Connection;
  private isPrimaryActive: boolean = true;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(primaryUrl: string, fallbackUrl: string) {
    this.primaryConnection = new Connection(primaryUrl, 'confirmed');
    this.fallbackConnection = new Connection(fallbackUrl, 'confirmed');
    this.activeConnection = this.primaryConnection;
  }

  /**
   * Returns the currently active RPC connection.
   * @returns Active Solana Connection
   */
  getConnection(): Connection {
    return this.activeConnection;
  }

  /**
   * Returns whether the primary connection is currently active.
   * @returns True if primary is active
   */
  isPrimaryConnectionActive(): boolean {
    return this.isPrimaryActive;
  }

  /**
   * Starts periodic health checks on the active RPC endpoint.
   */
  startHealthCheck(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        const rateLimiter = RateLimiter.getInstance();
        await rateLimiter.schedule(() => this.activeConnection.getSlot());
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('RPC health check failed, switching endpoint', {
          error: errorMsg,
          wasPrimary: this.isPrimaryActive,
        });
        this.switchConnection();
      }
    }, HEALTH_CHECK_INTERVAL_MS);

    logger.debug('RPC health check started', { intervalMs: HEALTH_CHECK_INTERVAL_MS });
  }

  /**
   * Switches between primary and fallback connections.
   */
  private switchConnection(): void {
    if (this.isPrimaryActive) {
      this.activeConnection = this.fallbackConnection;
      this.isPrimaryActive = false;
      logger.warn('Switched to fallback RPC endpoint');
    } else {
      this.activeConnection = this.primaryConnection;
      this.isPrimaryActive = true;
      logger.debug('Switched back to primary RPC endpoint');
    }
  }

  /**
   * Stops health check polling and cleans up.
   */
  stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      logger.debug('RPC health check stopped');
    }
  }
}
