import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

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

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize')) || 20));
  const statusFilter = params.get('status');
  const tokenFilter = params.get('token');
  const fromDate = params.get('from');
  const toDate = params.get('to');

  const where: Prisma.PositionWhereInput = {
    status: { in: ['closed', 'partial'] },
  };

  if (statusFilter === 'win') {
    where.pnlSol = { gt: 0 };
  } else if (statusFilter === 'loss') {
    where.pnlSol = { lt: 0 };
  } else if (statusFilter === 'stuck') {
    where.status = 'open';
  }

  if (tokenFilter) {
    where.tokenMint = { contains: tokenFilter };
  }

  if (fromDate) {
    where.closedAt = { ...(where.closedAt as object), gte: new Date(fromDate) };
  }
  if (toDate) {
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    where.closedAt = { ...(where.closedAt as object), lte: end };
  }

  let positions: Awaited<ReturnType<typeof prisma.position.findMany>>;
  let total: number;

  try {
    [positions, total] = await Promise.all([
      prisma.position.findMany({
        where,
        orderBy: { closedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.position.count({ where }),
    ]);
  } catch {
    return NextResponse.json(
      {
        error: 'Database unreachable',
        hint: 'mysql.railway.internal só resolve na rede Railway.',
        positions: [],
        total: 0,
        page: 1,
        pageSize: 20,
        summary: {
          totalTrades: 0,
          winRate: 0,
          avgWin: 0,
          avgLoss: 0,
          bestTrade: 0,
          worstTrade: 0,
        },
      },
      { status: 503 },
    );
  }

  const mints = [...new Set(positions.map((p) => p.tokenMint))];
  let tokens: { mintAddress: string; symbol: string }[];
  try {
    tokens = await prisma.token.findMany({
      where: { mintAddress: { in: mints } },
      select: { mintAddress: true, symbol: true },
    });
  } catch {
    tokens = [];
  }
  const symbolMap = Object.fromEntries(tokens.map((t) => [t.mintAddress, t.symbol]));

  let allClosed: { pnlSol: unknown; pnlPercent: unknown }[];
  try {
    allClosed = await prisma.position.findMany({
      where: { status: { in: ['closed', 'partial'] } },
      select: { pnlSol: true, pnlPercent: true },
    });
  } catch {
    allClosed = [];
  }

  const wins = allClosed.filter((p) => Number(p.pnlSol) > 0);
  const losses = allClosed.filter((p) => Number(p.pnlSol) <= 0);
  const pnlPercents = allClosed.map((p) => Number(p.pnlPercent));

  const summary = {
    totalTrades: allClosed.length,
    winRate: allClosed.length > 0 ? (wins.length / allClosed.length) * 100 : 0,
    avgWin: wins.length > 0 ? wins.reduce((s, p) => s + Number(p.pnlPercent), 0) / wins.length : 0,
    avgLoss:
      losses.length > 0
        ? losses.reduce((s, p) => s + Number(p.pnlPercent), 0) / losses.length
        : 0,
    bestTrade: pnlPercents.length > 0 ? Math.max(...pnlPercents) : 0,
    worstTrade: pnlPercents.length > 0 ? Math.min(...pnlPercents) : 0,
  };

  const mapped = positions.map((p) => {
    const holdTime =
      p.openedAt && p.closedAt
        ? new Date(p.closedAt).getTime() - new Date(p.openedAt).getTime()
        : 0;

    return {
      id: p.id,
      tokenMint: p.tokenMint,
      symbol: symbolMap[p.tokenMint] ?? '',
      entryPrice: Number(p.entryPriceSol),
      exitPrice: p.exitPriceSol ? Number(p.exitPriceSol) : null,
      pnlPercent: Number(p.pnlPercent),
      pnlSol: Number(p.pnlSol),
      strategyId: p.strategyId,
      holdTime,
      exitReason: deriveExitReason(p.strategyId, Number(p.pnlPercent)),
      openedAt: p.openedAt?.toISOString() ?? '',
      closedAt: p.closedAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({
    positions: mapped,
    total,
    page,
    pageSize,
    summary,
  });
}
