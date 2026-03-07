import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { dashboardConfig } from '@/config/dashboard.config';

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  return NextResponse.json({
    STRATEGY_TIER: dashboardConfig.bot.strategyTier,
    MAX_POSITION_SIZE_SOL: String(dashboardConfig.bot.maxPositionSizeSol),
    STOP_LOSS_PERCENT: String(dashboardConfig.bot.stopLossPercent),
    DRY_RUN: String(dashboardConfig.bot.dryRun),
    WALLET: dashboardConfig.bot.walletAddress || '(não configurado)',
  });
}
