import type { Server } from 'socket.io';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { dashboardConfig } from '@/config/dashboard.config';

const POSITION_UPDATE_INTERVAL = 10_000;

export function initSocketHandlers(io: Server) {
  const prisma = new PrismaClient();

  const redisClient = dashboardConfig.redis.url
    ? new Redis(dashboardConfig.redis.url, { lazyConnect: true, maxRetriesPerRequest: 3 })
    : new Redis({
        host: dashboardConfig.redis.host,
        port: dashboardConfig.redis.port,
        password: dashboardConfig.redis.password,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      });
  const redisSub = dashboardConfig.redis.url
    ? new Redis(dashboardConfig.redis.url, { maxRetriesPerRequest: 3 })
    : new Redis({
        host: dashboardConfig.redis.host,
        port: dashboardConfig.redis.port,
        password: dashboardConfig.redis.password,
        maxRetriesPerRequest: 3,
      });

  redisClient.on('error', () => {});
  redisSub.on('error', () => {});

  redisClient.connect().catch(() => {});
  redisSub.connect().catch(() => {});

  redisSub.subscribe('dashboard:force-exit').catch(() => {});
  redisSub.subscribe('bot:events').catch(() => {});

  redisSub.on('message', (channel, message) => {
    try {
      if (channel === 'dashboard:force-exit') {
        const data = JSON.parse(message);
        io.emit('alert', {
          id: `force-exit-${Date.now()}`,
          type: 'alert',
          message: `Force exit enviado para posição ${data.positionId}`,
          timestamp: new Date().toISOString(),
          data,
        });
        return;
      }
      if (channel === 'bot:events') {
        const data = JSON.parse(message) as {
          type?: string;
          tokenMint?: string;
          amountSOL?: number;
          timestamp?: string;
          openPositions?: unknown[];
          closedPositions?: unknown[];
          summary?: unknown;
        };
        const evType = data.type ?? 'bot_event';
        const payload = {
          id: `bot-${evType}-${Date.now()}`,
          type: evType,
          message:
            evType === 'DRY_RUN_BUY'
              ? `DRY RUN BUY: ${(data.amountSOL ?? 0).toFixed(4)} SOL em ${(data.tokenMint ?? '').slice(0, 8)}...`
              : evType === 'DRY_RUN_SELL'
                ? `DRY RUN SELL: ${(data.tokenMint ?? '').slice(0, 8)}... P&L ${(data as { pnlPct?: string }).pnlPct ?? '?'}%`
                : JSON.stringify(data),
          timestamp: data.timestamp ?? new Date().toISOString(),
          data,
        };
        io.emit('bot_event', payload);
        if (evType === 'DRY_RUN_BUY') io.emit('dry_run_buy', data);
        if (evType === 'DRY_RUN_UPDATE') io.emit('dry_run_update', data);
        if (evType === 'DRY_RUN_SELL') io.emit('dry_run_sell', data);
      }
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
    clearInterval(tradeInterval);
    redisSub.disconnect();
    redisClient.disconnect();
    prisma.$disconnect();
  });
}
