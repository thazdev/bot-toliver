import { z } from 'zod';
import dotenv from 'dotenv';
import type { AppConfig } from '../types/config.types.js';

dotenv.config();

const solanaSchema = z.object({
  heliusRpcUrl: z.string().min(1, 'HELIUS_RPC_URL is required'),
  heliusWsUrl: z.string().min(1, 'HELIUS_WS_URL is required'),
  fallbackRpcUrl: z.string().min(1),
  walletPrivateKey: z.string().min(1, 'WALLET_PRIVATE_KEY is required'),
});

const databaseSchema = z.object({
  host: z.string(),
  port: z.number().int().positive(),
  user: z.string(),
  password: z.string(),
  database: z.string(),
  url: z.string().optional(),
});

const redisSchema = z.object({
  host: z.string(),
  port: z.number().int().positive(),
  password: z.string(),
});

const jupiterSchema = z.object({
  apiUrl: z.string().url(),
});

const tradingSchema = z.object({
  totalCapitalSol: z.number().positive(),
  maxPositionSizeSol: z.number().positive(),
  maxOpenPositions: z.number().int().positive(),
  defaultSlippageBps: z.number().int().min(0).max(5000),
  stopLossPercent: z.number().min(0).max(100),
  takeProfitPercent: z.number().min(0).max(1000),
  maxDailyLossSol: z.number().positive(),
  strategyTier: z.enum(['conservative', 'balanced', 'aggressive']),
});

const botSchema = z.object({
  logLevel: z.string(),
  dryRun: z.boolean(),
});

const alertsSchema = z.object({
  telegramBotToken: z.string(),
  telegramChatId: z.string(),
});

const rateLimitSchema = z.object({
  rpcRequestsPerSecond: z.number().int().positive(),
  rpcMaxConcurrent: z.number().int().positive(),
});

const appConfigSchema = z.object({
  solana: solanaSchema,
  database: databaseSchema,
  redis: redisSchema,
  jupiter: jupiterSchema,
  trading: tradingSchema,
  bot: botSchema,
  alerts: alertsSchema,
  rateLimit: rateLimitSchema,
});

let cachedConfig: AppConfig | null = null;

function parseEnv(): AppConfig {
  const e = process.env;

  const dbUrl = e.MYSQL_PUBLIC_URL ?? e.MYSQL_URL ?? e.DATABASE_URL;

  const raw: AppConfig = {
    solana: {
      heliusRpcUrl: e.HELIUS_RPC_URL ?? '',
      heliusWsUrl: e.HELIUS_WS_URL ?? '',
      fallbackRpcUrl: e.FALLBACK_RPC_URL ?? e.HELIUS_RPC_URL ?? '',
      walletPrivateKey: e.WALLET_PRIVATE_KEY ?? '',
    },
    database: {
      host: e.MYSQL_HOST ?? e.MYSQLHOST ?? 'localhost',
      port: parseInt(e.MYSQL_PORT ?? e.MYSQLPORT ?? '3306', 10),
      user: e.MYSQL_USER ?? e.MYSQLUSER ?? 'root',
      password: e.MYSQL_PASSWORD ?? e.MYSQLPASSWORD ?? '',
      database: e.MYSQL_DATABASE ?? e.MYSQLDATABASE ?? 'trading_bot',
      url: dbUrl && dbUrl.startsWith('mysql') ? dbUrl : undefined,
    },
    redis: {
      host: e.REDIS_HOST ?? e.REDISHOST ?? 'localhost',
      port: parseInt(e.REDIS_PORT ?? e.REDISPORT ?? '6379', 10),
      password: e.REDIS_PASSWORD ?? e.REDISPASSWORD ?? '',
    },
    jupiter: {
      apiUrl: e.JUPITER_API_URL ?? 'https://quote-api.jup.ag/v6',
    },
    trading: {
      totalCapitalSol: parseFloat(e.TOTAL_CAPITAL_SOL ?? '0.9'),
      maxPositionSizeSol: parseFloat(e.MAX_POSITION_SIZE_SOL ?? '0.03'),
      maxOpenPositions: parseInt(e.MAX_OPEN_POSITIONS ?? '3', 10),
      defaultSlippageBps: parseInt(e.DEFAULT_SLIPPAGE_BPS ?? '300', 10),
      stopLossPercent: parseFloat(e.STOP_LOSS_PERCENT ?? '15'),
      takeProfitPercent: parseFloat(e.TAKE_PROFIT_PERCENT ?? '50'),
      maxDailyLossSol: parseFloat(e.MAX_DAILY_LOSS_SOL ?? '0.045'),
      strategyTier: (e.STRATEGY_TIER as 'conservative' | 'balanced' | 'aggressive') ?? 'conservative',
    },
    bot: {
      logLevel: e.LOG_LEVEL ?? 'warn',
      dryRun: true, // initial value; actual mode comes from Redis at runtime
    },
    alerts: {
      telegramBotToken: e.TELEGRAM_BOT_TOKEN ?? '',
      telegramChatId: e.TELEGRAM_CHAT_ID ?? '',
    },
    rateLimit: {
      rpcRequestsPerSecond: parseInt(e.RPC_REQUESTS_PER_SECOND ?? '2', 10),
      rpcMaxConcurrent: parseInt(e.RPC_MAX_CONCURRENT ?? '2', 10),
    },
  };

  return raw;
}

/**
 * Loads and validates all environment variables into a typed AppConfig object.
 * Crashes on startup if required variables are missing or invalid.
 */
export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const raw = parseEnv();
  const result = appConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    const msg = `\n[FATAL] Invalid configuration — bot cannot start.\n${issues}\n`;
    process.stderr.write(msg);
    process.exit(1);
  }

  cachedConfig = result.data;
  return cachedConfig;
}
