import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { dashboardConfig } from '@/config/dashboard.config';
import { redis } from '@/lib/redis';

const DRY_RUN_KEY = 'bot:dry_run';

async function getDryRun(): Promise<boolean> {
  try {
    await redis.connect().catch(() => {});
    const val = await redis.get(DRY_RUN_KEY);
    if (val !== null && val !== undefined) return val === 'true';
  } catch {}
  return dashboardConfig.bot.dryRun;
}

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  const dryRun = await getDryRun();

  return NextResponse.json({
    STRATEGY_TIER: dashboardConfig.bot.strategyTier,
    MAX_POSITION_SIZE_SOL: String(dashboardConfig.bot.maxPositionSizeSol),
    STOP_LOSS_PERCENT: String(dashboardConfig.bot.stopLossPercent),
    DRY_RUN: String(dryRun),
    WALLET: dashboardConfig.bot.walletAddress || '(não configurado)',
  });
}
