import type { Job } from 'bullmq';
import { logger } from '../../../utils/logger.js';
import type { TokenScanJobPayload } from '../../../types/queue.types.js';

/**
 * Processor for token detection queue jobs.
 * Receives raw token detection events and forwards to TokenScanner.
 * The actual scanner is injected at registration time through WorkerManager.
 * @param job - The BullMQ job containing a TokenScanJobPayload
 */
export async function tokenQueueProcessor(job: Job<TokenScanJobPayload>): Promise<void> {
  logger.debug('Processing token scan job', {
    jobId: job.id,
    source: job.data.source,
    mintAddress: job.data.tokenInfo.mintAddress,
  });
}

export const TOKEN_QUEUE_CONCURRENCY = 3;
