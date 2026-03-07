/**
 * Returns a promise that resolves after the specified milliseconds.
 * @param ms - Time in milliseconds to sleep
 * @returns A promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
