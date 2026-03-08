import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';
import { dashboardConfig } from '@/config/dashboard.config';
import { requireAuth } from '@/lib/auth-guard';

/**
 * Debug do health - verifica Redis, DB, bot_health, stats.
 * Acesse: /api/health/debug (logado)
 */
export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;
  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    checklist: [] as string[],
    redis: { connected: false, botHealth: null, dryRun: null, error: null as string | null },
    database: { connected: false, statsCount: 0, tradesCount: 0, error: null as string | null },
    config: {
      hasHeliusUrl: !!dashboardConfig.rpc.heliusUrl,
      hasWallet: !!dashboardConfig.bot.walletAddress,
      redisUrl: !!process.env.REDIS_URL,
    },
  };

  try {
    await redis.connect();
    (result.redis as Record<string, unknown>).connected = true;
    (result.checklist as string[]).push('Redis conectado');

    const [botHealth, dryRun] = await Promise.all([
      redis.get('bot_health'),
      redis.get('bot:dry_run'),
    ]);
    (result.redis as Record<string, unknown>).botHealth = botHealth;
    (result.redis as Record<string, unknown>).dryRun = dryRun;

    if (botHealth) {
      (result.checklist as string[]).push('bot_health no Redis — bot está rodando e conectado');
      try {
        (result.redis as Record<string, unknown>).parsed = JSON.parse(botHealth);
      } catch {
        (result.redis as Record<string, unknown>).parseError = true;
      }
    } else {
      (result.checklist as string[]).push('bot_health vazio — bot não está gravando ou usa Redis diferente');
    }
  } catch (e) {
    (result.redis as Record<string, unknown>).error = e instanceof Error ? e.message : String(e);
    (result.checklist as string[]).push(`Redis erro: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const [statsCount, tradesCount] = await Promise.all([
      prisma.stat.count(),
      prisma.trade.count(),
    ]);
    (result.database as Record<string, unknown>).connected = true;
    (result.database as Record<string, unknown>).statsCount = statsCount;
    (result.database as Record<string, unknown>).tradesCount = tradesCount;
    (result.checklist as string[]).push(`DB conectado — ${statsCount} stats, ${tradesCount} trades`);
  } catch (e) {
    (result.database as Record<string, unknown>).error = e instanceof Error ? e.message : String(e);
    (result.checklist as string[]).push(`DB erro: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json(result);
}
