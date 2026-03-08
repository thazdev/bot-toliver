import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { redis } from '@/lib/redis';

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const { prisma } = await import('@/lib/prisma');

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const closedStatuses = ['confirmed', 'dry_run_closed', 'closed'];

    const [allClosed, todayClosed, walletBalanceRaw] = await Promise.all([
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
      redis.get('wallet_balance_cache').catch(() => null),
    ]);

    const pnlTotal = allClosed.reduce((sum, p) => sum + Number(p.pnlSol), 0);
    const pnlToday = todayClosed.reduce((sum, p) => sum + Number(p.pnlSol), 0);
    const tradesToday = todayClosed.length;

    const wins = allClosed.filter((p) => Number(p.pnlSol) > 0).length;
    const winRate = allClosed.length > 0 ? Math.round((wins / allClosed.length) * 10000) / 100 : 0;

    const capitalFree = walletBalanceRaw ? parseFloat(walletBalanceRaw) : 0;

    return NextResponse.json({
      pnlToday: Math.round(pnlToday * 1e9) / 1e9,
      pnlTotal: Math.round(pnlTotal * 1e9) / 1e9,
      tradesToday,
      winRate,
      capitalFree,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch stats', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
