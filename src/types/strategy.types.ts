import type { TokenInfo } from './token.types.js';
import type { PoolInfo } from './pool.types.js';
import type { Position } from './position.types.js';

export type StrategySignal = 'buy' | 'sell' | 'hold' | 'skip';

export interface StrategyContext {
  tokenInfo: TokenInfo;
  poolInfo: PoolInfo;
  position?: Position;
  currentPrice: number;
  liquidity: number;
  volume: number;
  timestamp: number;
}

export interface StrategyResult {
  signal: StrategySignal;
  confidence: number;
  reason: string;
  suggestedSizeSol: number;
}
