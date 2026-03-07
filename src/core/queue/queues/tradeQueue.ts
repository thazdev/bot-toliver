import type { Job } from 'bullmq';
import { logger } from '../../../utils/logger.js';
import type { TradeExecuteJobPayload } from '../../../types/queue.types.js';

/**
 * Processor for trade execution queue jobs.
 * Receives trade requests and forwards to TradeExecutor.
 * The actual executor is injected at registration time through WorkerManager.
 * @param job - The BullMQ job containing a TradeExecuteJobPayload
 */
export async function tradeQueueProcessor(job: Job<TradeExecuteJobPayload>): Promise<void> {
  logger.debug('Processing trade execution job', {
    jobId: job.id,
    tokenMint: job.data.tradeRequest.tokenMint,
    direction: job.data.tradeRequest.direction,
  });
}

export const TRADE_QUEUE_CONCURRENCY = 1;
