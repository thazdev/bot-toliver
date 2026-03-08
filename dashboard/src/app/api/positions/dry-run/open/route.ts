import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireAuth } from '@/lib/auth-guard';

export interface DryRunOpenPosition {
  id: string;
  tokenMint: string;
  entryPrice: number;
  entryTime: string;
  amountSOL: number;
  amountTokens: number;
  entryScore: number;
  strategy: string;
  tier: string;
  stopLossPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  trailingStopPrice: number | null;
  peakPrice: number;
  currentPrice: number;
  currentPnlPct: number;
  currentPnlSOL: number;
  status: string;
}

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    await redis.connect().catch(() => {});

    const openIds = await redis.smembers('dry_positions:open');
    const positions: DryRunOpenPosition[] = [];

    for (const id of openIds) {
      const raw = await redis.get(`dry_position:${id}`);
      if (raw) {
        try {
          const pos = JSON.parse(raw);
          if (pos.status === 'open') {
            positions.push(pos);
          }
        } catch {
          // skip invalid
        }
      }
    }

    return NextResponse.json({ positions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, positions: [] }, { status: 500 });
  }
}
