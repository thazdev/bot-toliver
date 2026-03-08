import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const range = req.nextUrl.searchParams.get('range') ?? '24h';
  const now = new Date();
  const since = new Date(now);

  if (range === '7d') {
    since.setUTCDate(since.getUTCDate() - 7);
  } else {
    since.setUTCHours(since.getUTCHours() - 24);
  }

  const positions = await prisma.position.findMany({
    where: { status: 'closed', closedAt: { gte: since } },
    orderBy: { closedAt: 'asc' },
  });

  let cumulative = 0;
  const points = positions.map((p) => {
    cumulative += Number(p.pnlSol);
    return {
      timestamp: p.closedAt?.toISOString() ?? now.toISOString(),
      cumulativePnl: cumulative,
    };
  });

  const startPoint = { timestamp: since.toISOString(), cumulativePnl: 0 };
  const endPoint = { timestamp: now.toISOString(), cumulativePnl: points.at(-1)?.cumulativePnl ?? 0 };
  const result = points.length > 0 ? [startPoint, ...points] : [startPoint, endPoint];

  return NextResponse.json(result);
}
