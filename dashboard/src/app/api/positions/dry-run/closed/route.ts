import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export interface DryRunClosedPosition {
  id: string;
  tokenMint: string;
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  amountSOL: number;
  entryScore: number;
  strategy: string;
  exitReason: string;
  finalPnlPct: number;
  finalPnlSOL: number;
}

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    await redis.connect().catch(() => {});

    const rawList = await redis.lrange('dry_positions:closed', 0, 99);
    const positions: DryRunClosedPosition[] = [];

    for (const raw of rawList) {
      try {
        const pos = JSON.parse(raw);
        if (pos.status === 'closed') {
          positions.push({
            id: pos.id,
            tokenMint: pos.tokenMint,
            entryPrice: pos.entryPrice,
            exitPrice: pos.exitPrice ?? pos.currentPrice,
            entryTime: pos.entryTime,
            exitTime: pos.exitTime ?? '',
            amountSOL: pos.amountSOL,
            entryScore: pos.entryScore,
            strategy: pos.strategy,
            exitReason: pos.exitReason ?? 'unknown',
            finalPnlPct: pos.finalPnlPct ?? pos.currentPnlPct ?? 0,
            finalPnlSOL: pos.finalPnlSOL ?? pos.currentPnlSOL ?? 0,
          });
        }
      } catch {
        // skip invalid
      }
    }

    return NextResponse.json({ positions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, positions: [] }, { status: 500 });
  }
}
