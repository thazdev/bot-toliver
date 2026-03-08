import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireAuth } from '@/lib/auth-guard';

const TOTAL_CAPITAL_SOL = parseFloat(process.env.TOTAL_CAPITAL_SOL ?? '0.9');

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    await redis.connect().catch(() => {});

    const openIds = await redis.smembers('dry_positions:open');
    let capitalInUse = 0;
    const openPositions: { amountSOL: number }[] = [];

    for (const id of openIds) {
      const raw = await redis.get(`dry_position:${id}`);
      if (raw) {
        try {
          const pos = JSON.parse(raw);
          if (pos.status === 'open' && typeof pos.amountSOL === 'number') {
            capitalInUse += pos.amountSOL;
            openPositions.push({ amountSOL: pos.amountSOL });
          }
        } catch {
          // skip
        }
      }
    }

    const rawList = await redis.lrange('dry_positions:closed', 0, 99);
    const closed: { finalPnlSOL?: number; finalPnlPct?: number; entryTime?: string; exitTime?: string }[] = [];

    for (const raw of rawList) {
      try {
        const pos = JSON.parse(raw);
        if (pos.status === 'closed') {
          closed.push({
            finalPnlSOL: pos.finalPnlSOL ?? pos.currentPnlSOL ?? 0,
            finalPnlPct: pos.finalPnlPct ?? pos.currentPnlPct ?? 0,
            entryTime: pos.entryTime,
            exitTime: pos.exitTime,
          });
        }
      } catch {
        // skip
      }
    }

    const totalPnlSOL = closed.reduce((s, p) => s + (p.finalPnlSOL ?? 0), 0);
    const wins = closed.filter((p) => (p.finalPnlSOL ?? 0) > 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const pnlPercents = closed.map((p) => p.finalPnlPct ?? 0).filter((x) => isFinite(x));
    const bestTrade = pnlPercents.length > 0 ? Math.max(...pnlPercents) : 0;
    const worstTrade = pnlPercents.length > 0 ? Math.min(...pnlPercents) : 0;

    const holdTimes: number[] = closed
      .filter((p) => p.entryTime && p.exitTime)
      .map((p) => (new Date(p.exitTime!).getTime() - new Date(p.entryTime!).getTime()) / 60_000);
    const avgHoldMin = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;

    return NextResponse.json({
      totalCapitalSOL: TOTAL_CAPITAL_SOL,
      capitalInUse,
      capitalInUsePct: TOTAL_CAPITAL_SOL > 0 ? (capitalInUse / TOTAL_CAPITAL_SOL) * 100 : 0,
      availableCapital: Math.max(0, TOTAL_CAPITAL_SOL - capitalInUse),
      totalPnlSOL,
      winRate,
      bestTrade,
      worstTrade,
      avgHoldMin,
      openCount: openPositions.length,
      closedCount: closed.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
