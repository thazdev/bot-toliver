import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { redis } from '@/lib/redis';

export async function POST(request: Request) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = (await request.json()) as { mode?: string };
    const mode = body.mode;

    if (mode !== 'dry-run' && mode !== 'real') {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "dry-run" or "real".' },
        { status: 400 },
      );
    }

    await redis.set('bot:mode', mode);
    await redis.publish('bot:command', JSON.stringify({ action: 'mode_change', mode }));

    if (mode === 'real') {
      await redis.publish(
        'bot:command',
        JSON.stringify({ action: 'archive_dry_run_positions' }),
      );
    }

    return NextResponse.json({ mode, success: true });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to toggle mode', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
