import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { dashboardConfig } from '@/config/dashboard.config';

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

    const [allClosed, todayClosed, openPositions, walletSol] = await Promise.all([
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
    ]);

    const pnlTotal = allClosed.reduce((sum, p) => sum + Number(p.pnlSol), 0);
    const pnlToday = todayClosed.reduce((sum, p) => sum + Number(p.pnlSol), 0);
    const tradesToday = todayClosed.length;

    const wins = allClosed.filter((p) => Number(p.pnlSol) > 0).length;
    const winRate = allClosed.length > 0 ? Math.round((wins / allClosed.length) * 10000) / 100 : 0;

    const lockedInPositions = openPositions.reduce((sum, p) => sum + Number(p.amountSol ?? 0), 0);
    const totalCapital = walletSol + lockedInPositions;
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
