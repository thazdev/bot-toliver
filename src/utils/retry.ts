import { logger } from './logger.js';
import { sleep } from './sleep.js';

const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Retries an async function with exponential backoff and jitter.
 * @param fn - The async function to execute
 * @param retries - Maximum number of retry attempts
 * @param delayMs - Initial delay in milliseconds between retries
 * @param backoff - Backoff multiplier applied to delay on each retry
 * @returns The resolved value of the function
 */
export async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delayMs: number = 1000,
  backoff: number = 2,
): Promise<T> {
  let lastError: unknown;
  let currentDelay = delayMs;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < retries) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const jitter = Math.random() * currentDelay * 0.3;
        const actualDelay = Math.min(currentDelay + jitter, MAX_RETRY_DELAY_MS);
        logger.warn(`Retry attempt ${attempt + 1}/${retries} failed: ${errorMessage}`, {
          attempt: attempt + 1,
          maxRetries: retries,
          nextDelayMs: Math.round(actualDelay),
        });
        await sleep(actualDelay);
        currentDelay = Math.min(currentDelay * backoff, MAX_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}
