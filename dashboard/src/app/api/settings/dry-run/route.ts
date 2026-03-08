import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { redis } from '@/lib/redis';

const MODE_KEY = 'bot:mode';

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    await redis.connect().catch(() => {});
    const val = await redis.get(MODE_KEY);
    const mode = val === 'real' ? 'real' : 'dry-run';
    return NextResponse.json({ mode, dryRun: mode === 'dry-run' });
  } catch {
    return NextResponse.json({ mode: 'dry-run', dryRun: true });
  }
}

export async function POST(req: Request) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = await req.json();
    const mode: 'dry-run' | 'real' = body.mode === 'real' ? 'real' : 'dry-run';

    await redis.connect().catch(() => {});
    await redis.set(MODE_KEY, mode);
    await redis.publish('bot:command', JSON.stringify({ action: 'mode_change', mode }));

    return NextResponse.json({ mode, dryRun: mode === 'dry-run' });
  } catch {
    return NextResponse.json({ error: 'Erro ao atualizar modo' }, { status: 500 });
  }
}
