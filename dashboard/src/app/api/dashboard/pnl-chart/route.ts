import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth-guard';

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const range = req.nextUrl.searchParams.get('range') ?? '24h';
  const since = new Date();

  if (range === '7d') {
    since.setDate(since.getDate() - 7);
  } else {
    since.setHours(since.getHours() - 24);
  }

  const positions = await prisma.position.findMany({
    where: { status: 'closed', closedAt: { gte: since } },
    orderBy: { closedAt: 'asc' },
  });

  let cumulative = 0;
  const points = positions.map((p) => {
    cumulative += Number(p.pnlSol);
    return {
      timestamp: p.closedAt?.toISOString() ?? new Date().toISOString(),
      cumulativePnl: cumulative,
    };
  });

  if (points.length === 0) {
    points.push({ timestamp: new Date().toISOString(), cumulativePnl: 0 });
  }

  return NextResponse.json(points);
}
