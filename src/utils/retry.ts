import { logger } from './logger.js';
import { sleep } from './sleep.js';

/**
 * Retries an async function with exponential backoff.
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
        logger.warn(`Retry attempt ${attempt + 1}/${retries} failed: ${errorMessage}`, {
          attempt: attempt + 1,
          maxRetries: retries,
          nextDelayMs: currentDelay,
        });
        await sleep(currentDelay);
        currentDelay *= backoff;
      }
    }
  }

  throw lastError;
}
