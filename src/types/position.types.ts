export type PositionStatus = 'open' | 'closed' | 'partial';

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
