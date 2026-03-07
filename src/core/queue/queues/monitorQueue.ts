import type { Job } from 'bullmq';
import { logger } from '../../../utils/logger.js';
import type { PositionMonitorJobPayload } from '../../../types/queue.types.js';

/**
 * Processor for position monitoring queue jobs.
 * Receives position IDs and checks current state against thresholds.
 * The actual monitor logic is injected at registration time through WorkerManager.
 * @param job - The BullMQ job containing a PositionMonitorJobPayload
 */
export async function monitorQueueProcessor(job: Job<PositionMonitorJobPayload>): Promise<void> {
  logger.debug('Processing position monitor job', {
    jobId: job.id,
    positionId: job.data.positionId,
    tokenMint: job.data.tokenMint,
  });
}

export const MONITOR_QUEUE_CONCURRENCY = 2;
