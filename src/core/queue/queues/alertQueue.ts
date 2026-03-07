import type { Job } from 'bullmq';
import { logger } from '../../../utils/logger.js';
import type { AlertJobPayload } from '../../../types/queue.types.js';

/**
 * Processor for alert dispatch queue jobs.
 * Receives alert payloads and forwards to AlertService.
 * The actual service is injected at registration time through WorkerManager.
 * @param job - The BullMQ job containing an AlertJobPayload
 */
export async function alertQueueProcessor(job: Job<AlertJobPayload>): Promise<void> {
  logger.debug('Processing alert job', {
    jobId: job.id,
    level: job.data.level,
    message: job.data.message,
  });
}

export const ALERT_QUEUE_CONCURRENCY = 2;
