import type { TokenInfo } from './token.types.js';
import type { PoolInfo } from './pool.types.js';
import type { TradeRequest } from './trade.types.js';

export enum QueueName {
  TOKEN_SCAN = 'token-scan',
  TRADE_EXECUTE = 'trade-execute',
  POSITION_MONITOR = 'position-monitor',
  ALERT = 'alert',
}

export interface TokenScanJobPayload {
  tokenInfo: Partial<TokenInfo> & { poolAddress?: string; poolDex?: 'pumpfun' | 'raydium' };
  source: string;
  detectedAt: number;
  txSignature?: string;
  /** Quando true, o worker resolve o mint via getParsedTransaction antes de processar */
  needsResolution?: boolean;
  /** Contador de deferrals (gate de swap activity) — max 2 */
  deferCount?: number;
}

export interface TradeExecuteJobPayload {
  tradeRequest: TradeRequest;
  /** Opcional: entry score para logs de dry run */
  entryScore?: number;
}

export interface PositionMonitorJobPayload {
  positionId: string;
  tokenMint: string;
}

export interface AlertJobPayload {
  level: 'info' | 'warn' | 'error' | 'trade';
  message: string;
  data?: Record<string, unknown>;
}

export type QueueJobPayload =
  | TokenScanJobPayload
  | TradeExecuteJobPayload
  | PositionMonitorJobPayload
  | AlertJobPayload;
