import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';

export async function GET(request: Request) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const { prisma } = await import('@/lib/prisma');
    const url = new URL(request.url);

    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
    const mode = url.searchParams.get('mode') ?? 'all';
    const token = url.searchParams.get('token') ?? '';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const where: Record<string, unknown> = {};

    if (mode === 'dry_run' || mode === 'dry-run') {
      where.dryRun = true;
    } else if (mode === 'real') {
      where.dryRun = false;
    }

    if (token) {
      where.tokenMint = { contains: token };
    }

    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) dateFilter.lte = new Date(to);
      where.executedAt = dateFilter;
    }

    let trades, total;
    try {
      [trades, total] = await Promise.all([
        prisma.trade.findMany({
          where,
          orderBy: { executedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.trade.count({ where }),
      ]);
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      if (msg.includes("doesn't exist") || msg.includes('does not exist')) {
        return NextResponse.json({ trades: [], total: 0, page });
      }
      throw dbErr;
    }

    return NextResponse.json({ trades, total, page });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch trades', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
