import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { dashboardConfig } from '@/config/dashboard.config';
import { requireAuth } from '@/lib/auth-guard';

const CACHE_KEY = 'dashboard:wallet_balance';
const CACHE_TTL = 30;

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const walletAddress = session!.user.walletAddress || dashboardConfig.bot.walletAddress;
  if (!walletAddress) {
    return NextResponse.json({ sol: 0, usd: null });
  }

  try {
    await redis.connect().catch(() => {});
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return NextResponse.json(JSON.parse(cached));
    }
  } catch {}

  try {
    const res = await fetch(dashboardConfig.rpc.heliusUrl, {
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
    const lamports = json.result?.value ?? 0;
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
      await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(result));
    } catch {}

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ sol: 0, usd: null });
  }
}
