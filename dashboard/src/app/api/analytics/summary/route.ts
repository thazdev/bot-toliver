import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth-guard';

function deriveExitReason(strategyId: string, pnlPercent: number): string {
  const s = strategyId.toLowerCase();
  if (s.includes('stop') || s.includes('sl')) return 'Stop Loss';
  if (s.includes('tp2') || s.includes('take-profit-2')) return 'TP2';
  if (s.includes('tp1') || s.includes('tp') || s.includes('take-profit')) return 'TP1';
  if (s.includes('rug')) return 'Rug';
  if (s.includes('time') || s.includes('expire')) return 'Time';
  if (s.includes('manual') || s.includes('emergency') || s.includes('force')) return 'Manual';
  return pnlPercent > 0 ? 'TP1' : 'Stop Loss';
}

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  const closed = await prisma.position.findMany({
    where: { status: { in: ['closed', 'partial'] } },
    orderBy: { closedAt: 'asc' },
  });

  // Trades by hour
  const hourCounts = new Array(24).fill(0);
  closed.forEach((p) => {
    if (p.openedAt) hourCounts[new Date(p.openedAt).getHours()]++;
  });
  const tradesByHour = hourCounts.map((count, hour) => ({ hour, count }));

  // Score vs ROI — strategy_id as proxy for score
  const scoreVsRoi = closed.map((p) => ({
    score: p.strategyId || 'default',
    roi: Number(p.pnlPercent),
  }));

  // Win rate rolling 20
  const winRateRolling: { index: number; winRate: number }[] = [];
  for (let i = 19; i < closed.length; i++) {
    const window = closed.slice(i - 19, i + 1);
    const wins = window.filter((p) => Number(p.pnlSol) > 0).length;
    winRateRolling.push({ index: i - 19, winRate: (wins / 20) * 100 });
  }

  // Exit reasons
  const reasonCounts: Record<string, number> = {};
  closed.forEach((p) => {
    const reason = deriveExitReason(p.strategyId, Number(p.pnlPercent));
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  });
  const exitReasons = Object.entries(reasonCounts).map(([reason, count]) => ({ reason, count }));

  // Max drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let cumPnl = 0;
  closed.forEach((p) => {
    cumPnl += Number(p.pnlSol);
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  });

  // Streaks
  let bestWinStreak = 0;
  let worstLossStreak = 0;
  let currentWins = 0;
  let currentLosses = 0;
  closed.forEach((p) => {
    if (Number(p.pnlSol) > 0) {
      currentWins++;
      currentLosses = 0;
      if (currentWins > bestWinStreak) bestWinStreak = currentWins;
    } else {
      currentLosses++;
      currentWins = 0;
      if (currentLosses > worstLossStreak) worstLossStreak = currentLosses;
    }
  });

  return NextResponse.json({
    tradesByHour,
    scoreVsRoi,
    winRateRolling,
    exitReasons,
    maxDrawdown,
    bestWinStreak,
    worstLossStreak,
  });
}
