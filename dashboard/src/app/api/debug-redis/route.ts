import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const results: Record<string, string | null> = {};
  const errors: string[] = [];

  try {
    await redis.connect().catch(() => {});
  } catch (e) {
    errors.push(`connect: ${e instanceof Error ? e.message : String(e)}`);
  }

  const keys = [
    'bot_health',
    'bot:lifecycle_state',
    'bot:enabled',
    'bot:mode',
  ];

  for (const key of keys) {
    try {
      results[key] = await redis.get(key);
    } catch (e) {
      results[key] = null;
      errors.push(`get(${key}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let redisStatus = 'unknown';
  try {
    const pong = await redis.ping();
    redisStatus = pong === 'PONG' ? 'connected' : `unexpected: ${pong}`;
  } catch (e) {
    redisStatus = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json({
    redisStatus,
    keys: results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
}
