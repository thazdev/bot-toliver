import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';
import { ReconnectHandler } from './ReconnectHandler.js';
import { EventRouter, type WsSubscription } from './EventRouter.js';

/**
 * Manages the raw WebSocket connection lifecycle to the Helius WS endpoint.
 * Handles connection, disconnection, reconnection, and message routing.
 */
export class WebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private reconnectHandler: ReconnectHandler;
  private eventRouter: EventRouter;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private subscriptionCounter: number = 1;

  constructor(wsUrl: string) {
    super();
    this.wsUrl = wsUrl;
    this.reconnectHandler = new ReconnectHandler();
    this.eventRouter = new EventRouter();
  }

  /**
   * Establishes the WebSocket connection.
   */
  async connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    try {
      await this.createConnection();
    } catch (error: unknown) {
      this.isConnecting = false;
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('WebSocket initial connection failed', { error: errorMsg });
      await this.handleReconnect();
    }
  }

  private createConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        this.isConnecting = false;
        this.reconnectHandler.reset();
        logger.info('WebSocket connected', { url: this.wsUrl.slice(0, 40) + '...' });
        this.emit('connected');
        this.resubscribeAll();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        const message = data.toString();
        this.emit('message', message);
        this.eventRouter.routeMessage(message);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        logger.warn('WebSocket disconnected', {
          code,
          reason: reason.toString(),
        });
        this.emit('disconnected', code);
        if (this.shouldReconnect) {
          this.handleReconnect();
        }
      });

      this.ws.on('error', (error: Error) => {
        logger.error('WebSocket error', { error: error.message });
        if (this.isConnecting) {
          reject(error);
        }
      });
    });
  }

  private async handleReconnect(): Promise<void> {
    if (!this.shouldReconnect) {
      return;
    }

    this.emit('reconnecting', this.reconnectHandler.getAttempt());
    await this.reconnectHandler.waitForReconnect();

    try {
      await this.createConnection();
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('WebSocket reconnect attempt failed', { error: errorMsg });
      await this.handleReconnect();
    }
  }

  private resubscribeAll(): void {
    const subs = this.eventRouter.getActiveSubscriptions();
    for (const sub of subs) {
      this.sendRaw({
        jsonrpc: '2.0',
        id: sub.id,
        method: sub.method,
        params: sub.params,
      });
    }
    if (subs.length > 0) {
      logger.info('Re-subscribed to all active subscriptions', { count: subs.length });
    }
  }

  /**
   * Sends a subscription request over the WebSocket.
   * @param method - The RPC method (e.g. "logsSubscribe")
   * @param params - The subscription parameters
   * @returns The subscription object with its ID
   */
  subscribe(method: string, params: unknown[]): WsSubscription {
    const id = this.subscriptionCounter++;
    const subscription: WsSubscription = { id, method, params };
    this.eventRouter.registerSubscription(subscription);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendRaw({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
    }

    return subscription;
  }

  /**
   * Unsubscribes from a WebSocket subscription.
   * @param subscriptionId - The server-side subscription ID
   * @param method - The unsubscribe method (e.g. "logsUnsubscribe")
   */
  unsubscribe(subscriptionId: number, method: string): void {
    this.eventRouter.removeSubscription(subscriptionId);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendRaw({
        jsonrpc: '2.0',
        id: this.subscriptionCounter++,
        method,
        params: [subscriptionId],
      });
    }
  }

  /**
   * Returns the EventRouter for registering message handlers.
   * @returns The EventRouter instance
   */
  getEventRouter(): EventRouter {
    return this.eventRouter;
  }

  private sendRaw(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Disconnects the WebSocket and stops reconnection.
   */
  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.eventRouter.clearSubscriptions();

    if (this.ws) {
      this.ws.close(1000, 'Shutting down');
      this.ws = null;
    }

    logger.info('WebSocketManager disconnected');
  }
}
