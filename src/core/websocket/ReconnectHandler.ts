import { logger } from '../../utils/logger.js';
import { sleep } from '../../utils/sleep.js';
import { WS_RECONNECT_BASE_MS, WS_RECONNECT_MAX_MS } from '../../utils/constants.js';

/**
 * Handles WebSocket reconnection with exponential backoff and jitter.
 */
export class ReconnectHandler {
  private attempt: number = 0;
  private baseDelay: number;
  private maxDelay: number;

  constructor(
    baseDelay: number = WS_RECONNECT_BASE_MS,
    maxDelay: number = WS_RECONNECT_MAX_MS,
  ) {
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
  }

  /**
   * Waits for the appropriate backoff delay before next reconnect attempt.
   * Includes jitter to avoid thundering herd.
   */
  async waitForReconnect(): Promise<void> {
    const exponentialDelay = Math.min(
      this.baseDelay * Math.pow(2, this.attempt),
      this.maxDelay,
    );
    const jitter = Math.random() * exponentialDelay * 0.3;
    const totalDelay = Math.floor(exponentialDelay + jitter);

    logger.info('WebSocket reconnect scheduled', {
      attempt: this.attempt + 1,
      delayMs: totalDelay,
    });

    await sleep(totalDelay);
    this.attempt++;
  }

  /**
   * Resets the reconnect attempt counter (call on successful connection).
   */
  reset(): void {
    this.attempt = 0;
  }

  /**
   * Returns the current reconnect attempt number.
   * @returns Current attempt count
   */
  getAttempt(): number {
    return this.attempt;
  }
}
