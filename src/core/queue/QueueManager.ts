import { Queue } from 'bullmq';
import { logger } from '../../utils/logger.js';
import { QueueName } from '../../types/queue.types.js';
import type { QueueConnectionConfig } from '../../config/queue.config.js';

/**
 * Factory and registry for all BullMQ queues.
 * Creates and manages queue instances for each QueueName.
 */
export class QueueManager {
  private queues: Map<QueueName, Queue> = new Map();
  private connectionConfig: QueueConnectionConfig;

  constructor(connectionConfig: QueueConnectionConfig) {
    this.connectionConfig = connectionConfig;
  }

  /**
   * Initializes all application queues.
   */
  async initialize(): Promise<void> {
    for (const queueName of Object.values(QueueName)) {
      const queue = new Queue(queueName, {
        connection: this.connectionConfig.connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      });

      this.queues.set(queueName as QueueName, queue);
      logger.debug('Queue initialized', { queueName });
    }
  }

  /**
   * Returns a queue by name.
   * @param name - The QueueName to retrieve
   * @returns The BullMQ Queue instance
   */
  getQueue(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue not found: ${name}`);
    }
    return queue;
  }

  /**
   * Adds a job to the specified queue.
   * @param queueName - Target queue name
   * @param jobName - Name for the job
   * @param data - Job payload data
   * @param options - Optional: delay in ms for deferred execution
   * @returns The created job
   */
  async addJob<T extends Record<string, unknown>>(
    queueName: QueueName,
    jobName: string,
    data: T,
    options?: { delay?: number },
  ): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.add(jobName, data, options);
    // Log removido: "Job added to queue" gerava excesso de logs
  }

  /**
   * Gracefully closes all queues.
   */
  async shutdown(): Promise<void> {
    const closePromises = Array.from(this.queues.values()).map((queue) =>
      queue.close(),
    );
    await Promise.all(closePromises);
    this.queues.clear();
    logger.debug('All queues closed');
  }
}
