'use client';

import useSWR from 'swr';
import { TrendingUp, Target, Layers, ShieldAlert } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { Header } from '@/components/layout/Header';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { PnlChart } from '@/components/dashboard/PnlChart';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { OpenPositionsTable } from '@/components/dashboard/OpenPositionsTable';
import { fetcher } from '@/lib/fetcher';
import type { KpiData } from '@/types';

export default function OverviewPage() {
  const { data: kpi } = useSWR<KpiData>('/api/dashboard/overview', fetcher, {
    refreshInterval: 15_000,
  });

  return (
    <DashboardShell>
      <Header />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="P&L Hoje"
          value={kpi?.pnlToday ?? 0}
          suffix=" SOL"
          decimals={4}
          icon={TrendingUp}
        />
        <KpiCard
          title="Win Rate 30d"
          value={kpi?.winRate30d ?? 0}
          suffix="%"
          decimals={1}
          icon={Target}
          neutral
        />
        <KpiCard
          title="Posições Abertas"
          value={kpi?.openPositions ?? 0}
          decimals={0}
          icon={Layers}
          neutral
        />
        <KpiCard
          title="Capital em Risco"
          value={kpi?.capitalAtRisk ?? 0}
          suffix=" SOL"
          decimals={4}
          icon={ShieldAlert}
          neutral
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PnlChart />
        </div>
        <ActivityFeed />
      </div>

      <OpenPositionsTable />
    </DashboardShell>
  );
}
