import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

/**
 * Debug do health - mostra se Redis conecta e o que tem em bot_health.
 * Acesse: /api/health/debug
 */
export async function GET() {
  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    redis: { connected: false, botHealth: null, error: null as string | null },
  };

  try {
    await redis.connect();
    (result.redis as Record<string, unknown>).connected = true;

    const botHealth = await redis.get('bot_health');
    (result.redis as Record<string, unknown>).botHealth = botHealth;

    if (botHealth) {
      try {
        (result.redis as Record<string, unknown>).parsed = JSON.parse(botHealth);
      } catch {
        (result.redis as Record<string, unknown>).parseError = true;
      }
    }
  } catch (e) {
    (result.redis as Record<string, unknown>).error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(result);
}
