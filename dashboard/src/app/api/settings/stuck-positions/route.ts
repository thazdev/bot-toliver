import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth-guard';
import type { StuckPosition } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    await redis.connect().catch(() => {});

    const keys = await redis.keys('stuck_position:*');
    const results: StuckPosition[] = [];

    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;

      const data = JSON.parse(raw);
      const positionId = key.replace('stuck_position:', '');

      let symbol = '';
      try {
        const token = await prisma.token.findFirst({
          where: { mintAddress: data.tokenMint ?? '' },
          select: { symbol: true },
        });
        symbol = token?.symbol ?? '';
      } catch {}

      results.push({
        positionId,
        tokenMint: data.tokenMint ?? '',
        symbol,
        amountSol: data.amountSol ?? 0,
        stuckAt: data.stuckAt ?? data.timestamp ?? new Date().toISOString(),
        note: data.note,
      });
    }

    return NextResponse.json(results);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const { positionId, note } = await req.json();
  if (!positionId) {
    return NextResponse.json({ error: 'positionId required' }, { status: 400 });
  }

  try {
    await redis.connect().catch(() => {});
    await redis.del(`stuck_position:${positionId}`);

    if (note) {
      await redis.setex(
        `stuck_resolved:${positionId}`,
        86400 * 7,
        JSON.stringify({ resolvedAt: new Date().toISOString(), note }),
      );
    }
  } catch {}

  return NextResponse.json({ success: true });
}
