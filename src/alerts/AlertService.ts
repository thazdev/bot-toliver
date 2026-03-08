import { logger } from '../utils/logger.js';
import { TelegramProvider } from './providers/TelegramProvider.js';
import type { AppConfig } from '../types/config.types.js';

/**
 * Dispatches alerts to all registered alert providers.
 * Consumes ALERT queue jobs and forwards to Telegram and other providers.
 */
export class AlertService {
  private telegramProvider: TelegramProvider;

  constructor(config: AppConfig) {
    this.telegramProvider = new TelegramProvider(config);
  }

  /**
   * Sends an alert to all active providers.
   * @param level - Alert severity level
   * @param message - Alert message
   * @param data - Optional context data
   */
  async sendAlert(
    level: 'info' | 'warn' | 'error' | 'trade',
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    logger.debug('Alert dispatched', { level, message });

    try {
      await this.telegramProvider.send(level, message, data);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('AlertService: failed to dispatch alert', {
        level,
        message,
        error: errorMsg,
      });
    }
  }
}
