export type TradeDirection = 'buy' | 'sell';

export type TradeStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'cancelled';

export interface TradeRequest {
  tokenMint: string;
  direction: TradeDirection;
  amountSol: number;
  slippageBps: number;
  strategyId: string;
  dryRun: boolean;
}

export interface TradeResult {
  tradeRequest: TradeRequest;
  txSignature: string | null;
  status: TradeStatus;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  fee: number;
  executedAt: Date;
  error: string | null;
}
