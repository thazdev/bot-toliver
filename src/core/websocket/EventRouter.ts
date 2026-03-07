import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';

export interface WsSubscription {
  id: number;
  method: string;
  params: unknown[];
}

/**
 * Routes raw WebSocket messages to registered handlers based on subscription type.
 */
export class EventRouter extends EventEmitter {
  private subscriptions: Map<number, WsSubscription> = new Map();

  /**
   * Registers a subscription to route messages for.
   * @param subscription - The subscription details
   */
  registerSubscription(subscription: WsSubscription): void {
    this.subscriptions.set(subscription.id, subscription);
    logger.debug('EventRouter: subscription registered', {
      id: subscription.id,
      method: subscription.method,
    });
  }

  /**
   * Removes a subscription from routing.
   * @param id - The subscription ID to remove
   */
  removeSubscription(id: number): void {
    this.subscriptions.delete(id);
    logger.debug('EventRouter: subscription removed', { id });
  }

  /**
   * Routes a raw WebSocket message to the appropriate handler.
   * @param rawMessage - The raw message string from WebSocket
   */
  routeMessage(rawMessage: string): void {
    try {
      const parsed = JSON.parse(rawMessage) as Record<string, unknown>;

      if (parsed.method && typeof parsed.method === 'string') {
        this.emit(parsed.method, parsed.params);
        return;
      }

      if (parsed.result !== undefined && typeof parsed.id === 'number') {
        const sub = this.subscriptions.get(parsed.id);
        if (sub) {
          this.emit(`result:${sub.method}`, parsed.result);
        }
        return;
      }

      if (parsed.params && typeof parsed.params === 'object') {
        const params = parsed.params as Record<string, unknown>;
        if (typeof params.subscription === 'number') {
          this.emit(`subscription:${params.subscription}`, params.result);
        }
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('EventRouter: failed to parse message', { error: errorMsg });
    }
  }

  /**
   * Returns all active subscriptions for re-registration after reconnect.
   * @returns Array of active subscriptions
   */
  getActiveSubscriptions(): WsSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Clears all subscriptions.
   */
  clearSubscriptions(): void {
    this.subscriptions.clear();
  }
}
