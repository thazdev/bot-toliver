export const dashboardConfig = {
  database: { url: process.env.DATABASE_URL! },
  redis: {
    host: process.env.REDIS_HOST || process.env.REDISHOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || process.env.REDISPORT) || 6379,
    password: process.env.REDIS_PASSWORD || process.env.REDISPASSWORD || undefined,
  },
  rpc: { heliusUrl: process.env.HELIUS_RPC_URL || process.env.HELIUS_RPC_URI || '' },
  auth: {
    secret: process.env.NEXTAUTH_SECRET!,
    maxUsers: 2,
  },
  bot: {
    walletAddress: process.env.BOT_WALLET_ADDRESS || '',
    strategyTier: process.env.BOT_STRATEGY_TIER || 'conservative',
    maxPositionSizeSol: Number(process.env.BOT_MAX_POSITION_SIZE_SOL) || 0.05,
    stopLossPercent: Number(process.env.BOT_STOP_LOSS_PERCENT) || 15,
    dryRun: process.env.BOT_DRY_RUN === 'true',
  },
  jupiter: {
    priceUrl: 'https://price.jup.ag/v4/price',
  },
  socket: {
    path: '/api/socket',
    positionUpdateInterval: 10_000,
  },
} as const;
