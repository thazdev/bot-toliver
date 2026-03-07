import { Worker, type Processor, type Job } from 'bullmq';
import { logger } from '../../utils/logger.js';
import { QueueName } from '../../types/queue.types.js';
import type { QueueConnectionConfig } from '../../config/queue.config.js';

/**
 * Manages BullMQ worker lifecycle for all queues.
 */
export class WorkerManager {
  private workers: Map<QueueName, Worker> = new Map();
  private connectionConfig: QueueConnectionConfig;

  constructor(connectionConfig: QueueConnectionConfig) {
    this.connectionConfig = connectionConfig;
  }

  /**
   * Registers a worker processor for a given queue.
   * @param queueName - The queue to attach the worker to
   * @param processor - The job processor function
   * @param concurrency - Number of concurrent jobs to process
   */
  registerWorker(
    queueName: QueueName,
    processor: Processor,
    concurrency: number = 1,
  ): void {
    if (this.workers.has(queueName)) {
      logger.warn('Worker already registered, skipping', { queueName });
      return;
    }

    const worker = new Worker(queueName, processor, {
      connection: this.connectionConfig.connection,
      concurrency,
    });

    worker.on('completed', (job: Job) => {
      logger.debug('Job completed', { queueName, jobId: job.id, jobName: job.name });
    });

    worker.on('failed', (job: Job | undefined, error: Error) => {
      logger.error('Job failed', {
        queueName,
        jobId: job?.id,
        jobName: job?.name,
        error: error.message,
      });
    });

    worker.on('error', (error: Error) => {
      logger.error('Worker error', { queueName, error: error.message });
    });

    this.workers.set(queueName, worker);
    logger.info('Worker registered', { queueName, concurrency });
  }

  /**
   * Gracefully shuts down all workers.
   */
  async shutdown(): Promise<void> {
    const closePromises = Array.from(this.workers.values()).map((worker) =>
      worker.close(),
    );
    await Promise.all(closePromises);
    this.workers.clear();
    logger.info('All workers shut down');
  }
}
