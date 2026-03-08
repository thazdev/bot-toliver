import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { redis } from '@/lib/redis';

const DRY_RUN_KEY = 'bot:dry_run';

export async function POST(req: Request) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const { dryRun } = await req.json();
    const value = dryRun === true || dryRun === 'true' ? 'true' : 'false';

    await redis.connect().catch(() => {});
    await redis.set(DRY_RUN_KEY, value);

    return NextResponse.json({ dryRun: value === 'true' });
  } catch (e) {
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}
