import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { dashboardConfig } from '@/config/dashboard.config';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const MODE_KEY = 'bot:mode';
const BOT_ENABLED_KEY = 'bot:enabled';

async function getRedisBool(key: string, fallback: boolean): Promise<boolean> {
  try {
    await redis.connect().catch(() => {});
    const val = await redis.get(key);
    if (val !== null && val !== undefined) return val === 'true';
  } catch {}
  return fallback;
}

async function getBotMode(): Promise<'dry-run' | 'real'> {
  try {
    const val = await redis.get(MODE_KEY);
    if (val === 'real') return 'real';
  } catch {}
  return 'dry-run';
}

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  await redis.connect().catch(() => {});

  const [botEnabled, mode] = await Promise.all([
    getRedisBool(BOT_ENABLED_KEY, true),
    getBotMode(),
  ]);

  return NextResponse.json({
    BOT_ENABLED: String(botEnabled),
    MODE: mode,
    STRATEGY_TIER: dashboardConfig.bot.strategyTier,
    MAX_POSITION_SIZE_SOL: String(dashboardConfig.bot.maxPositionSizeSol),
    STOP_LOSS_PERCENT: String(dashboardConfig.bot.stopLossPercent),
    WALLET: dashboardConfig.bot.walletAddress || '(not set)',
  });
}
