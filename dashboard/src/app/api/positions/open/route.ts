import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth-guard';
import { dashboardConfig } from '@/config/dashboard.config';

export const dynamic = 'force-dynamic';

async function fetchJupiterPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  try {
    const url = `${dashboardConfig.jupiter.priceUrl}?ids=${mints.join(',')}`;
    const res = await fetch(url, { next: { revalidate: 10 } });
    const json = await res.json();
    const prices: Record<string, number> = {};
    for (const mint of mints) {
      prices[mint] = json.data?.[mint]?.price ?? 0;
    }
    return prices;
  } catch {
    return {};
  }
}

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  const positions = await prisma.position.findMany({
    where: { status: 'open' },
    orderBy: { openedAt: 'desc' },
  });

  const mints = positions.map((p) => p.tokenMint);
  const prices = await fetchJupiterPrices(mints);

  const tokens = await prisma.token.findMany({
    where: { mintAddress: { in: mints } },
    select: { mintAddress: true, symbol: true },
  });
  const symbolMap = Object.fromEntries(tokens.map((t) => [t.mintAddress, t.symbol]));

  const result = positions.map((p) => {
    const currentPrice = prices[p.tokenMint] || Number(p.currentPriceSol);
    const entryPrice = Number(p.entryPriceSol);
    const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
    const pnlSol = Number(p.amountSol) * (pnlPercent / 100);

    return {
      id: p.id,
      tokenMint: p.tokenMint,
      symbol: symbolMap[p.tokenMint] ?? '',
      entryPrice,
      currentPrice,
      pnlPercent,
      pnlSol,
      amountSol: Number(p.amountSol),
      openedAt: p.openedAt?.toISOString() ?? '',
      strategyId: p.strategyId,
    };
  });

  return NextResponse.json(result);
}
