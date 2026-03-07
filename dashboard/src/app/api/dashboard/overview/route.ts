import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth-guard';

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [openPositions, closedToday, thirtyDaysAgo] = await Promise.all([
    prisma.position.findMany({ where: { status: 'open' } }),
    prisma.position.findMany({
      where: { status: 'closed', closedAt: { gte: todayStart } },
    }),
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return prisma.position.findMany({
        where: { status: 'closed', closedAt: { gte: d } },
      });
    })(),
  ]);

  const pnlToday = closedToday.reduce((sum, p) => sum + Number(p.pnlSol), 0);
  const wins30d = thirtyDaysAgo.filter((p) => Number(p.pnlSol) > 0).length;
  const winRate30d = thirtyDaysAgo.length > 0 ? (wins30d / thirtyDaysAgo.length) * 100 : 0;
  const capitalAtRisk = openPositions.reduce((sum, p) => sum + Number(p.amountSol), 0);

  return NextResponse.json({
    pnlToday,
    winRate30d,
    openPositions: openPositions.length,
    capitalAtRisk,
  });
}
