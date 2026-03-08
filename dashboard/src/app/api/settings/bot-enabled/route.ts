import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { redis } from '@/lib/redis';

const BOT_ENABLED_KEY = 'bot:enabled';

export async function POST(req: Request) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const { enabled } = await req.json();
    const value = enabled === true || enabled === 'true' ? 'true' : 'false';

    await redis.connect().catch(() => {});
    await redis.set(BOT_ENABLED_KEY, value);

    return NextResponse.json({ enabled: value === 'true' });
  } catch (e) {
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}
