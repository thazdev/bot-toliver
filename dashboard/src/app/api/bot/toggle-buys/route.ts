import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const BUYS_PAUSED_KEY = 'bot:buys_paused';

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    await redis.connect().catch(() => {});
    const val = await redis.get(BUYS_PAUSED_KEY);
    return NextResponse.json({ buysPaused: val === 'true' });
  } catch (e) {
    return NextResponse.json({ error: 'Erro ao ler status' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const { paused } = await req.json();
    const value = paused === true || paused === 'true' ? 'true' : 'false';

    await redis.connect().catch(() => {});
    await redis.set(BUYS_PAUSED_KEY, value);

    return NextResponse.json({ buysPaused: value === 'true' });
  } catch (e) {
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}
