import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { dashboardConfig } from '@/config/dashboard.config';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

async function fetchWalletSol(walletAddress: string): Promise<number> {
  const heliusUrl = dashboardConfig.rpc.heliusUrl;
  if (!heliusUrl || !walletAddress) return 0;

  try {
    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [walletAddress],
      }),
    });
    const json = await res.json();
    if (json.result?.value != null) return json.result.value / 1e9;
  } catch {}
  return 0;
}

/**
 * Fetch dry-run stats from Redis (open + closed positions).
 */
async function fetchDryRunStats(): Promise<{
  pnlToday: number;
  tradesToday: number;
  totalPnl: number;
  totalTrades: number;
  wins: number;
  capitalInUse: number;
}> {
  const result = { pnlToday: 0, tradesToday: 0, totalPnl: 0, totalTrades: 0, wins: 0, capitalInUse: 0 };

  try {
    await redis.connect().catch(() => {});

    // Open positions — capital in use
    const openIds = await redis.smembers('dry_positions:open');
    for (const id of openIds) {
      const raw = await redis.get(`dry_position:${id}`);
      if (raw) {
        try {
          const pos = JSON.parse(raw);
          if (pos.status === 'open' && typeof pos.amountSOL === 'number') {
            result.capitalInUse += pos.amountSOL;
          }
        } catch {}
      }
    }

    // Closed positions — P&L, win rate, trades today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const closedRaw = await redis.lrange('dry_positions:closed', 0, -1);
    for (const raw of closedRaw) {
      try {
        const pos = JSON.parse(raw);
        if (pos.status !== 'closed') continue;

        const pnl = pos.finalPnlSOL ?? pos.currentPnlSOL ?? 0;
        result.totalPnl += pnl;
        result.totalTrades += 1;
        if (pnl > 0) result.wins += 1;

        // Check if closed today
        const exitTime = pos.exitTime ? new Date(pos.exitTime).getTime() : 0;
        if (exitTime >= todayMs) {
          result.pnlToday += pnl;
          result.tradesToday += 1;
        }
      } catch {}
    }
  } catch {}

  return result;
}

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const { prisma } = await import('@/lib/prisma');

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const closedStatuses = ['confirmed', 'dry_run_closed', 'closed'];
    const openStatuses = ['open', 'active', 'monitoring'];

    const walletAddress = (
      session!.user.walletAddress ||
      dashboardConfig.bot.walletAddress ||
      ''
    ).trim();

    const [allClosed, todayClosed, openPositions, walletSol, dryStats] = await Promise.all([
      prisma.position.findMany({
        where: { status: { in: closedStatuses } },
        select: { pnlSol: true },
      }),
      prisma.position.findMany({
        where: {
          status: { in: closedStatuses },
          closedAt: { gte: todayStart },
        },
        select: { pnlSol: true },
      }),
      prisma.position.findMany({
        where: { status: { in: openStatuses } },
        select: { amountSol: true },
      }),
      fetchWalletSol(walletAddress),
      fetchDryRunStats(),
    ]);

    // Merge Prisma (real) + Redis (dry-run)
    const pnlTotalPrisma = allClosed.reduce((sum: number, p: { pnlSol: unknown }) => sum + Number(p.pnlSol), 0);
    const pnlTodayPrisma = todayClosed.reduce((sum: number, p: { pnlSol: unknown }) => sum + Number(p.pnlSol), 0);
    const tradesTodayPrisma = todayClosed.length;
    const winsPrisma = allClosed.filter((p: { pnlSol: unknown }) => Number(p.pnlSol) > 0).length;

    const pnlTotal = pnlTotalPrisma + dryStats.totalPnl;
    const pnlToday = pnlTodayPrisma + dryStats.pnlToday;
    const tradesToday = tradesTodayPrisma + dryStats.tradesToday;

    const totalTrades = allClosed.length + dryStats.totalTrades;
    const totalWins = winsPrisma + dryStats.wins;
    const winRate = totalTrades > 0 ? Math.round((totalWins / totalTrades) * 10000) / 100 : 0;

    const lockedInPositions = openPositions.reduce((sum: number, p: { amountSol: unknown }) => sum + Number(p.amountSol ?? 0), 0);
    const totalCapital = walletSol + lockedInPositions + dryStats.capitalInUse;
    const pnlTodayPercent = totalCapital > 0 ? (pnlToday / totalCapital) * 100 : 0;

    return NextResponse.json({
      pnlToday: Math.round(pnlToday * 1e9) / 1e9,
      pnlTodayPercent: Math.round(pnlTodayPercent * 100) / 100,
      pnlTotal: Math.round(pnlTotal * 1e9) / 1e9,
      tradesToday,
      winRate,
      totalCapital: Math.round(totalCapital * 1e6) / 1e6,
      availableCapital: Math.round(walletSol * 1e6) / 1e6,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch stats', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
