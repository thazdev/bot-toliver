import type { Server } from 'socket.io';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const POSITION_UPDATE_INTERVAL = 10_000;
const HEALTH_CHECK_INTERVAL = 15_000;

export function initSocketHandlers(io: Server) {
  const prisma = new PrismaClient();

  const redisOpts = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
  };

  const redisClient = new Redis(redisOpts);
  const redisSub = new Redis(redisOpts);

  redisClient.connect().catch(() => {});
  redisSub.connect().catch(() => {});

  redisSub.subscribe('dashboard:force-exit').catch(() => {});

  redisSub.on('message', (_channel, message) => {
    try {
      const data = JSON.parse(message);
      io.emit('alert', {
        id: `force-exit-${Date.now()}`,
        type: 'alert',
        message: `Force exit enviado para posição ${data.positionId}`,
        timestamp: new Date().toISOString(),
        data,
      });
    } catch {}
  });

  // Poll open positions and emit updates
  const positionInterval = setInterval(async () => {
    try {
      const positions = await prisma.position.findMany({ where: { status: 'open' } });

      const mints = positions.map((p) => p.tokenMint);
      let prices: Record<string, number> = {};

      if (mints.length > 0) {
        try {
          const res = await fetch(
            `https://price.jup.ag/v4/price?ids=${mints.join(',')}`,
          );
          const json = await res.json();
          for (const mint of mints) {
            prices[mint] = json.data?.[mint]?.price ?? 0;
          }
        } catch {}
      }

      const updates = positions.map((p) => {
        const currentPrice = prices[p.tokenMint] || Number(p.currentPriceSol);
        const entryPrice = Number(p.entryPriceSol);
        const pnlPercent =
          entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

        return {
          id: p.id,
          tokenMint: p.tokenMint,
          currentPrice,
          pnlPercent,
          pnlSol: Number(p.amountSol) * (pnlPercent / 100),
        };
      });

      io.emit('position_update', updates);
    } catch {}
  }, POSITION_UPDATE_INTERVAL);

  // Poll bot health
  const healthInterval = setInterval(async () => {
    try {
      const raw = await redisClient.get('bot_health');
      const isDryRun = process.env.BOT_DRY_RUN === 'true';

      if (raw) {
        const health = JSON.parse(raw);
        io.emit('bot_status', {
          id: `health-${Date.now()}`,
          type: 'alert',
          message: `Bot status: ${isDryRun ? 'DRY RUN' : health.status ?? 'RUNNING'}`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {}
  }, HEALTH_CHECK_INTERVAL);

  // Monitor recent trades for activity feed
  let lastTradeCheck = new Date();
  const tradeInterval = setInterval(async () => {
    try {
      const recentTrades = await prisma.trade.findMany({
        where: {
          executedAt: { gt: lastTradeCheck },
          status: 'confirmed',
        },
        orderBy: { executedAt: 'asc' },
      });

      lastTradeCheck = new Date();

      for (const trade of recentTrades) {
        const token = await prisma.token.findFirst({
          where: { mintAddress: trade.tokenMint },
          select: { symbol: true },
        });

        const symbol = token?.symbol || trade.tokenMint.slice(0, 8);
        const direction = trade.direction === 'buy' ? 'Compra' : 'Venda';
        const amount = Number(trade.amountSol).toFixed(4);

        io.emit('trade_executed', {
          id: `trade-${trade.id}`,
          type: trade.direction === 'buy' ? 'buy' : 'sell',
          message: `${direction} ${symbol} — ${amount} SOL`,
          timestamp: trade.executedAt?.toISOString() ?? new Date().toISOString(),
          data: {
            tokenMint: trade.tokenMint,
            direction: trade.direction,
            amountSol: Number(trade.amountSol),
            priceSol: Number(trade.priceSol),
          },
        });
      }
    } catch {}
  }, 5_000);

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  process.on('SIGTERM', () => {
    clearInterval(positionInterval);
    clearInterval(healthInterval);
    clearInterval(tradeInterval);
    redisSub.disconnect();
    redisClient.disconnect();
    prisma.$disconnect();
  });
}
