import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const ALLOWED_KEYS = ['stop_loss', 'take_profit', 'max_position_size', 'max_open_positions', 'slippage'] as const;
type ConfigKey = (typeof ALLOWED_KEYS)[number];

function isAllowedKey(key: string): key is ConfigKey {
  return (ALLOWED_KEYS as readonly string[]).includes(key);
}

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const entries = await Promise.all(
      ALLOWED_KEYS.map(async (key) => {
        const value = await redis.get(`bot:config:${key}`).catch(() => null);
        return [key, value] as const;
      }),
    );

    const config: Record<string, string | null> = {};
    for (const [key, value] of entries) {
      config[key] = value;
    }

    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch config', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = (await request.json()) as { key?: string; value?: string };
    const { key, value } = body;

    if (!key || value === undefined || value === null) {
      return NextResponse.json(
        { error: 'Missing required fields: key and value' },
        { status: 400 },
      );
    }

    if (!isAllowedKey(key)) {
      return NextResponse.json(
        { error: `Invalid config key. Allowed: ${ALLOWED_KEYS.join(', ')}` },
        { status: 400 },
      );
    }

    await redis.set(`bot:config:${key}`, String(value));
    await redis.publish('bot:command', JSON.stringify({ action: 'config_update', key, value }));

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to update config', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
