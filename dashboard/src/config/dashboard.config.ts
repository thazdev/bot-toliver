function getRedisOpts(): { url?: string; host?: string; port?: number; password?: string } {
  const url = process.env.REDIS_URL;
  if (url && url.startsWith('redis://')) return { url };
  return {
    host: process.env.REDIS_HOST || process.env.REDISHOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || process.env.REDISPORT) || 6379,
    password: process.env.REDIS_PASSWORD || process.env.REDISPASSWORD || undefined,
  };
}

export const dashboardConfig = {
  database: { url: process.env.DATABASE_URL! },
  redis: getRedisOpts(),
  rpc: { heliusUrl: process.env.HELIUS_RPC_URL || process.env.HELIUS_RPC_URI || '' },
  auth: {
    secret: process.env.NEXTAUTH_SECRET!,
    maxUsers: 2,
  },
  bot: {
    walletAddress: process.env.BOT_WALLET_ADDRESS || '',
    strategyTier: process.env.STRATEGY_TIER || 'conservative',
    maxPositionSizeSol: Number(process.env.MAX_POSITION_SIZE_SOL) || 0.03,
    stopLossPercent: Number(process.env.STOP_LOSS_PERCENT) || 15,
    dryRun: false,
  },
  jupiter: {
    priceUrl: 'https://price.jup.ag/v4/price',
  },
  socket: {
    path: '/api/socket',
    positionUpdateInterval: 10_000,
  },
} as const;
