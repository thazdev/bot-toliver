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
const JOB_ADDED_LOG_THROTTLE_MS = 30_000;

export abstract class BaseListener {
  private static lastIgnoredLogAt = 0;
  private static lastJobAddedLogAt = 0;

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
          if (!d.mintAddress || d.mintAddress.length < 32) {
            if (Date.now() - BaseListener.lastIgnoredLogAt > 10_000) {
              BaseListener.lastIgnoredLogAt = Date.now();
              logger.info('BaseListener: TOKEN_DETECTED ignorado — mint vazio ou inválido', {
                source: this.name,
                mintLen: d.mintAddress?.length ?? 0,
              });
            }
            break;
          }
          await this.queueManager.addJob(QueueName.TOKEN_SCAN, 'token-detected', {
            tokenInfo: {
              ...d,
              poolAddress: d.poolAddress || undefined,
              poolDex: d.dex === 'pumpfun' ? 'pumpfun' : 'raydium',
            },
            source: this.name,
            detectedAt: event.timestamp,
          } satisfies TokenScanJobPayload);
          if (Date.now() - BaseListener.lastJobAddedLogAt > JOB_ADDED_LOG_THROTTLE_MS) {
            BaseListener.lastJobAddedLogAt = Date.now();
            logger.info('BaseListener: job TOKEN_SCAN adicionado', { source: this.name, type: 'TOKEN_DETECTED' });
          }
          break;
        }
        case 'POOL_CREATED': {
          const d = event.data as import('../types/pool.types.js').PoolInfo;
          if (!d.tokenMint || d.tokenMint.length < 32) {
            if (Date.now() - BaseListener.lastIgnoredLogAt > 10_000) {
              BaseListener.lastIgnoredLogAt = Date.now();
              logger.info('BaseListener: POOL_CREATED ignorado — tokenMint vazio ou inválido', {
                source: this.name,
                tokenMintLen: d.tokenMint?.length ?? 0,
              });
            }
            break;
          }
          await this.queueManager.addJob(QueueName.TOKEN_SCAN, 'pool-created', {
            tokenInfo: {
              mintAddress: d.tokenMint,
              poolAddress: d.poolAddress || undefined,
              poolDex: d.dex === 'pumpfun' ? 'pumpfun' : 'raydium',
            },
            source: this.name,
            detectedAt: event.timestamp,
          } satisfies TokenScanJobPayload);
          if (Date.now() - BaseListener.lastJobAddedLogAt > JOB_ADDED_LOG_THROTTLE_MS) {
            BaseListener.lastJobAddedLogAt = Date.now();
            logger.info('BaseListener: job TOKEN_SCAN adicionado', { source: this.name, type: event.type });
          }
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
