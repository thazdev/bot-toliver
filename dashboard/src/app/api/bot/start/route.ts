import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { redis } from '@/lib/redis';

export async function POST() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    await redis.set('bot:enabled', 'true');
    await redis.publish('bot:command', JSON.stringify({ action: 'start' }));

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to start bot', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
