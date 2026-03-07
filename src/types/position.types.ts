import type { StopLossState } from './strategy.types.js';

export type PositionStatus = 'open' | 'closed' | 'partial' | 'stuck' | 'closed_external';

export interface Position {
  id: string;
  tokenMint: string;
  entryPrice: number;
  currentPrice: number;
  amountSol: number;
  tokenAmount: number;
  status: PositionStatus;
  strategyId: string;
  openedAt: Date;
  closedAt: Date | null;
  pnlSol: number;
  pnlPercent: number;
  stopLoss: number;
  takeProfit: number;
}

export interface ExitTranche {
  targetPercent: number;
  sellPercent: number;
  executed: boolean;
  executedAt?: Date;
}

export interface EnhancedPosition extends Position {
  peakPrice: number;
  stopLossState: StopLossState;
  trailingStopDelta: number;
  currentStopPrice: number;
  exitTranches: ExitTranche[];
  remainingPercent: number;
  originalAmountSol: number;
  originalTokenAmount: number;
  poolAddress: string;
}
