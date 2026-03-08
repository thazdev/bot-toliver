import axios from 'axios';
import { logger } from '../../utils/logger.js';
import type { AppConfig } from '../../types/config.types.js';

/**
 * Sends formatted alert messages to a Telegram bot.
 * Only activates if TELEGRAM_BOT_TOKEN is configured.
 */
export class TelegramProvider {
  private botToken: string;
  private chatId: string;
  private enabled: boolean;
  private apiUrl: string;

  constructor(config: AppConfig) {
    this.botToken = config.alerts.telegramBotToken;
    this.chatId = config.alerts.telegramChatId;
    this.enabled = Boolean(this.botToken && this.chatId);
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;

    if (this.enabled) {
      logger.debug('TelegramProvider enabled');
    } else {
      logger.debug('TelegramProvider disabled (no bot token or chat ID)');
    }
  }

  /**
   * Sends a message to the configured Telegram chat.
   * @param level - Alert level ('info', 'warn', 'error', 'trade')
   * @param message - The alert message
   * @param data - Optional additional data
   */
  async send(level: string, message: string, data?: Record<string, unknown>): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const emoji = this.getLevelEmoji(level);
      let text = `${emoji} *${level.toUpperCase()}*\n\n${message}`;

      if (data) {
        const dataStr = Object.entries(data)
          .map(([key, value]) => `• ${key}: \`${String(value)}\``)
          .join('\n');
        text += `\n\n${dataStr}`;
      }

      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: this.chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }, {
        timeout: 10000,
      });

      logger.debug('TelegramProvider: message sent', { level });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TelegramProvider: failed to send message', { error: errorMsg });
    }
  }

  /**
   * Returns whether the provider is active.
   * @returns True if enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  private getLevelEmoji(level: string): string {
    switch (level) {
      case 'trade': return '\u{1F4B0}';
      case 'error': return '\u{1F6A8}';
      case 'warn': return '\u{26A0}\u{FE0F}';
      default: return '\u{2139}\u{FE0F}';
    }
  }
}
