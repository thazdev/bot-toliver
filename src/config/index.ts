import dotenv from 'dotenv';
import type { AppConfig } from '../types/config.types.js';
import { loadDatabaseConfig } from './database.config.js';
import { loadRedisConfig } from './redis.config.js';
import { loadRpcConfig } from './rpc.config.js';

dotenv.config();

let cachedConfig: AppConfig | null = null;

/**
 * Loads and validates all environment variables into a typed AppConfig object.
 * Caches the result for subsequent calls.
 * @returns The full application configuration
 */
export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const solana = loadRpcConfig();
  const database = loadDatabaseConfig();
  const redis = loadRedisConfig();

  const config: AppConfig = {
    solana,
    database,
    redis,
    jupiter: {
      apiUrl: process.env.JUPITER_API_URL ?? 'https://quote-api.jup.ag/v6',
    },
    trading: {
      totalCapitalSol: parseFloat(process.env.TOTAL_CAPITAL_SOL ?? '1'),
      maxPositionSizeSol: parseFloat(process.env.MAX_POSITION_SIZE_SOL ?? '0.1'),
      maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS ?? '5', 10),
      defaultSlippageBps: parseInt(process.env.DEFAULT_SLIPPAGE_BPS ?? '300', 10),
      stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT ?? '20'),
      takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT ?? '50'),
      maxDailyLossSol: parseFloat(process.env.MAX_DAILY_LOSS_SOL ?? '0.5'),
      strategyTier: (process.env.STRATEGY_TIER as 'conservative' | 'balanced' | 'aggressive') ?? 'balanced',
    },
    bot: {
      logLevel: process.env.LOG_LEVEL ?? 'info',
      dryRun: process.env.DRY_RUN !== 'false',
    },
    alerts: {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
    },
    rateLimit: {
      rpcRequestsPerSecond: parseInt(process.env.RPC_REQUESTS_PER_SECOND ?? '10', 10),
      rpcMaxConcurrent: parseInt(process.env.RPC_MAX_CONCURRENT ?? '5', 10),
    },
  };

  cachedConfig = config;
  return config;
}
