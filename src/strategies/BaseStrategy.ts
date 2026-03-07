import type { StrategyContext, StrategyResult } from '../types/strategy.types.js';

/**
 * Abstract base class for all trading strategies.
 * Each strategy must implement the evaluate method which analyzes market conditions
 * and returns a signal with confidence score.
 */
export abstract class BaseStrategy {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly version: string;

  private enabled: boolean = true;

  /**
   * Evaluates the current market context and produces a trading signal.
   * @param context - The market context with token, pool, price, and volume data
   * @returns A StrategyResult with signal, confidence, reason, and suggested size
   */
  abstract evaluate(context: StrategyContext): Promise<StrategyResult>;

  /**
   * Returns whether this strategy is currently enabled.
   * @returns True if the strategy is active
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enables or disables this strategy.
   * @param enabled - Whether the strategy should be enabled
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}
