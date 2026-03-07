import type { StrategyTier } from './strategy.types.js';

export interface SolanaConfig {
  heliusRpcUrl: string;
  heliusWsUrl: string;
  fallbackRpcUrl: string;
  walletPrivateKey: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
}

export interface JupiterConfig {
  apiUrl: string;
}

export interface TradingConfig {
  totalCapitalSol: number;
  maxPositionSizeSol: number;
  maxOpenPositions: number;
  defaultSlippageBps: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxDailyLossSol: number;
  strategyTier: StrategyTier;
}

export interface BotBehaviorConfig {
  logLevel: string;
  dryRun: boolean;
}

export interface AlertConfig {
  telegramBotToken: string;
  telegramChatId: string;
}

export interface RateLimitConfig {
  rpcRequestsPerSecond: number;
  rpcMaxConcurrent: number;
}

export interface AppConfig {
  solana: SolanaConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  jupiter: JupiterConfig;
  trading: TradingConfig;
  bot: BotBehaviorConfig;
  alerts: AlertConfig;
  rateLimit: RateLimitConfig;
}
