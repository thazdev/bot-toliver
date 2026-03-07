export interface KpiData {
  pnlToday: number;
  winRate30d: number;
  openPositions: number;
  capitalAtRisk: number;
}

export interface PnlPoint {
  timestamp: string;
  cumulativePnl: number;
}

export interface OpenPosition {
  id: string;
  tokenMint: string;
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  pnlPercent: number;
  pnlSol: number;
  amountSol: number;
  openedAt: string;
  strategyId: string;
}

export interface PositionHistory {
  id: string;
  tokenMint: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number | null;
  pnlPercent: number;
  pnlSol: number;
  strategyId: string;
  holdTime: number;
  exitReason: string;
  openedAt: string;
  closedAt: string | null;
}

export interface PositionHistoryResponse {
  positions: PositionHistory[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    totalTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
  };
}

export interface AnalyticsSummary {
  tradesByHour: { hour: number; count: number }[];
  scoreVsRoi: { score: string; roi: number }[];
  winRateRolling: { index: number; winRate: number }[];
  exitReasons: { reason: string; count: number }[];
  maxDrawdown: number;
  bestWinStreak: number;
  worstLossStreak: number;
}

export interface BotHealth {
  status: 'RUNNING' | 'HALTED' | 'DRY_RUN' | 'UNKNOWN';
  lastHeartbeat: string | null;
  uptimeSeconds: number;
}

export interface WalletBalance {
  sol: number;
  usd: number | null;
}

export interface ActivityEvent {
  id: string;
  type: 'buy' | 'sell' | 'stop_loss' | 'rug_rejected' | 'stuck' | 'alert';
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface StuckPosition {
  positionId: string;
  tokenMint: string;
  symbol: string;
  amountSol: number;
  stuckAt: string;
  note?: string;
}

export interface UserProfile {
  id: number;
  username: string;
  displayName: string;
  walletAddress: string;
  tier: string;
}
