import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { dashboardConfig } from '@/config/dashboard.config';
import { redis } from '@/lib/redis';

const DRY_RUN_KEY = 'bot:dry_run';
const BOT_ENABLED_KEY = 'bot:enabled';

async function getRedisBool(key: string, fallback: boolean): Promise<boolean> {
  try {
    await redis.connect().catch(() => {});
    const val = await redis.get(key);
    if (val !== null && val !== undefined) return val === 'true';
  } catch {}
  return fallback;
}

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  const [dryRun, botEnabled] = await Promise.all([
    getRedisBool(DRY_RUN_KEY, dashboardConfig.bot.dryRun),
    getRedisBool(BOT_ENABLED_KEY, true),
  ]);

  return NextResponse.json({
    BOT_ENABLED: String(botEnabled),
    STRATEGY_TIER: dashboardConfig.bot.strategyTier,
    MAX_POSITION_SIZE_SOL: String(dashboardConfig.bot.maxPositionSizeSol),
    STOP_LOSS_PERCENT: String(dashboardConfig.bot.stopLossPercent),
    DRY_RUN: dryRun ? 'true' : 'false',
    WALLET: dashboardConfig.bot.walletAddress || '(não configurado)',
  });
}
