import { logger } from '../utils/logger.js';
import { BaseStrategy } from './BaseStrategy.js';
import type { StrategyContext, StrategyResult } from '../types/strategy.types.js';

/**
 * Registry that holds, manages, and runs all registered trading strategies.
 * Evaluates all strategies for a given context and returns aggregated results.
 */
export class StrategyRegistry {
  private strategies: BaseStrategy[] = [];

  /**
   * Registers a new strategy in the registry.
   * @param strategy - The strategy instance to register
   */
  register(strategy: BaseStrategy): void {
    this.strategies.push(strategy);
    logger.debug('Strategy registered', {
      name: strategy.name,
      version: strategy.version,
      description: strategy.description,
    });
  }

  /**
   * Evaluates all enabled strategies against the given context.
   * Returns the highest-confidence BUY if any strategy signals BUY.
   * Returns SELL if any active strategy signals SELL for an open position.
   * @param context - The market context to evaluate
   * @returns Array of strategy results from all enabled strategies
   */
  async evaluateAll(context: StrategyContext): Promise<StrategyResult[]> {
    const results: StrategyResult[] = [];

    for (const strategy of this.strategies) {
      if (!strategy.isEnabled()) {
        continue;
      }

      try {
        const result = await strategy.evaluate(context);
        results.push(result);

        logger.debug('Strategy evaluation', {
          strategy: strategy.name,
          signal: result.signal,
          confidence: result.confidence,
          reason: result.reason,
        });
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('Strategy evaluation failed', {
          strategy: strategy.name,
          error: errorMsg,
        });
      }
    }

    return results;
  }

  /**
   * Gets the best BUY signal from all results (highest confidence).
   * @param results - Array of strategy results
   * @returns The best BUY result or null
   */
  getBestBuySignal(results: StrategyResult[]): StrategyResult | null {
    const buySignals = results.filter((r) => r.signal === 'buy' && r.confidence > 0);
    if (buySignals.length === 0) {
      return null;
    }
    return buySignals.reduce((best, current) =>
      current.confidence > best.confidence ? current : best,
    );
  }

  /**
   * Checks if any strategy is signaling SELL.
   * @param results - Array of strategy results
   * @returns The sell result or null
   */
  getSellSignal(results: StrategyResult[]): StrategyResult | null {
    return results.find((r) => r.signal === 'sell') ?? null;
  }

  /**
   * Returns the count of registered strategies.
   * @returns Number of strategies
   */
  getStrategyCount(): number {
    return this.strategies.length;
  }

  /**
   * Returns all registered strategy names.
   * @returns Array of strategy names
   */
  getStrategyNames(): string[] {
    return this.strategies.map((s) => s.name);
  }
}
