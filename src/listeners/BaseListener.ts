import { logger } from '../utils/logger.js';
import type { BotEvent } from '../types/event.types.js';
import { QueueManager } from '../core/queue/QueueManager.js';
import { QueueName } from '../types/queue.types.js';
import type { TokenScanJobPayload } from '../types/queue.types.js';
import { isBotEnabled } from '../config/BotEnabledResolver.js';

/**
 * Abstract base class for all Solana event listeners.
 * Provides common lifecycle management and event dispatching.
 */
export abstract class BaseListener {
  protected name: string;
  protected isActive: boolean = false;
  protected queueManager: QueueManager;

  constructor(name: string, queueManager: QueueManager) {
    this.name = name;
    this.queueManager = queueManager;
  }

  /**
   * Starts listening for events. Must be implemented by subclasses.
   */
  abstract start(): Promise<void>;

  /**
   * Stops listening and cleans up subscriptions.
   */
  async stop(): Promise<void> {
    this.isActive = false;
    logger.info(`${this.name} listener stopped`);
  }

  /**
   * Pushes a detected event to the appropriate queue.
   * @param event - The bot event to dispatch
   */
  protected async onEvent(event: BotEvent): Promise<void> {
    try {
      if (!(await isBotEnabled())) {
        return;
      }
      switch (event.type) {
        case 'TOKEN_DETECTED': {
          const d = event.data;
          await this.queueManager.addJob(QueueName.TOKEN_SCAN, 'token-detected', {
            tokenInfo: {
              ...d,
              poolAddress: d.poolAddress || undefined,
              poolDex: d.dex === 'pumpfun' ? 'pumpfun' : 'raydium',
            },
            source: this.name,
            detectedAt: event.timestamp,
          } satisfies TokenScanJobPayload);
          break;
        }
        case 'POOL_CREATED': {
          const d = event.data as import('../types/pool.types.js').PoolInfo;
          await this.queueManager.addJob(QueueName.TOKEN_SCAN, 'pool-created', {
            tokenInfo: {
              mintAddress: d.tokenMint,
              poolAddress: d.poolAddress || undefined,
              poolDex: d.dex === 'pumpfun' ? 'pumpfun' : 'raydium',
            },
            source: this.name,
            detectedAt: event.timestamp,
          } satisfies TokenScanJobPayload);
          break;
        }
        default:
          logger.debug('BaseListener: unhandled event type', { type: event.type, listener: this.name });
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('BaseListener: failed to dispatch event', {
        listener: this.name,
        eventType: event.type,
        error: errorMsg,
      });
    }
  }
}
