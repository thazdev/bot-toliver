import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';
import { dashboardConfig } from '@/config/dashboard.config';
import { requireAuth } from '@/lib/auth-guard';

const CACHE_TTL = 30;

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  let walletAddress = (session!.user.walletAddress || dashboardConfig.bot.walletAddress || '').trim();

  if (!walletAddress && session!.user.id) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: parseInt(session!.user.id, 10) },
        select: { walletAddress: true },
      });
      walletAddress = (user?.walletAddress || '').trim();
    } catch {}
  }

  if (!walletAddress) {
    return NextResponse.json({ sol: 0, usd: null }, { status: 500 });
  }

  if (walletAddress.length > 50) {
    return NextResponse.json(
      { sol: 0, usd: null, error: 'Wallet inválida (parece chave privada)' },
      { status: 500 },
    );
  }

  const skipCache = req.nextUrl.searchParams.get('nocache') === '1';

  if (!skipCache) {
    try {
      await redis.connect().catch(() => {});
      const cacheKey = `dashboard:wallet_balance:${walletAddress}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(JSON.parse(cached));
      }
    } catch {}
  }

  const heliusUrl = dashboardConfig.rpc.heliusUrl;
  if (!heliusUrl) {
    return NextResponse.json({ sol: 0, usd: null }, { status: 500 });
  }

  try {
    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [walletAddress],
      }),
    });

    const json = await res.json();
    if (json.error || json.result == null) {
      return NextResponse.json({ sol: 0, usd: null }, { status: 500 });
    }
    const lamports = json.result.value ?? 0;
    const sol = lamports / 1e9;

    let usd: number | null = null;
    try {
      const solPriceRaw = await redis.get('price:SOL_USD');
      if (solPriceRaw) {
        const parsed = JSON.parse(solPriceRaw);
        usd = sol * (parsed.price ?? parsed);
      }
    } catch {}

    const result = { sol, usd };

    try {
      await redis.setex(`dashboard:wallet_balance:${walletAddress}`, CACHE_TTL, JSON.stringify(result));
    } catch {}

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ sol: 0, usd: null }, { status: 500 });
  }
}
