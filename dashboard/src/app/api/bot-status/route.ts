import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { redis } from '@/lib/redis';

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const [healthRaw, mode, enabled] = await Promise.all([
      redis.get('bot_health').catch(() => null),
      redis.get('bot:mode').catch(() => null),
      redis.get('bot:enabled').catch(() => null),
    ]);

    let state: 'RUNNING' | 'STOPPED' | 'STARTING' = 'STOPPED';
    let uptime = 0;
    let heliusConnected = false;

    if (healthRaw) {
      try {
        const health = JSON.parse(healthRaw) as Record<string, unknown>;
        uptime = typeof health.uptime === 'number' ? health.uptime : 0;
        heliusConnected = health.heliusConnected === true;

        if (enabled === 'true') {
          state = uptime > 0 ? 'RUNNING' : 'STARTING';
        }
      } catch {
        /* ignore parse errors */
      }
    }

    return NextResponse.json({
      state,
      mode: mode ?? 'dry-run',
      uptime,
      heliusConnected,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch bot status', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
