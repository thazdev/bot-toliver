'use client';

import useSWR from 'swr';
import { TrendingDown, Flame, Frown } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlowNumber } from '@/components/ui/GlowNumber';
import { TradesByHourChart } from '@/components/analytics/TradesByHourChart';
import { ScoreVsRoiChart } from '@/components/analytics/ScoreVsRoiChart';
import { WinRateChart } from '@/components/analytics/WinRateChart';
import { ExitReasonsChart } from '@/components/analytics/ExitReasonsChart';
import { fetcher } from '@/lib/fetcher';
import type { AnalyticsSummary } from '@/types';

export default function AnalyticsPage() {
  const { data } = useSWR<AnalyticsSummary>('/api/analytics/summary', fetcher, {
    refreshInterval: 60_000,
  });

  if (!data) {
    return (
      <DashboardShell>
        <h1 className="mb-6 text-lg font-bold text-white">Analytics</h1>
        <p className="text-sm text-slate-500">Carregando dados…</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <h1 className="mb-6 text-lg font-bold text-white">Analytics</h1>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <GlassCard className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Max Drawdown</p>
            <div className="mt-1 text-xl font-bold">
              <GlowNumber value={data.maxDrawdown} suffix=" SOL" decimals={4} />
            </div>
          </div>
          <div className="rounded-xl bg-danger/10 p-2.5">
            <TrendingDown className="h-5 w-5 text-danger" />
          </div>
        </GlassCard>

        <GlassCard className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Melhor Sequência Wins
            </p>
            <div className="mt-1 text-xl font-bold text-success">{data.bestWinStreak}</div>
          </div>
          <div className="rounded-xl bg-success/10 p-2.5">
            <Flame className="h-5 w-5 text-success" />
          </div>
        </GlassCard>

        <GlassCard className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Pior Sequência Losses
            </p>
            <div className="mt-1 text-xl font-bold text-danger">{data.worstLossStreak}</div>
          </div>
          <div className="rounded-xl bg-danger/10 p-2.5">
            <Frown className="h-5 w-5 text-danger" />
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TradesByHourChart data={data.tradesByHour} />
        <ScoreVsRoiChart data={data.scoreVsRoi} />
        <WinRateChart data={data.winRateRolling} />
        <ExitReasonsChart data={data.exitReasons} />
      </div>
    </DashboardShell>
  );
}
