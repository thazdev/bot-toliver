'use client';

import useSWR from 'swr';
import { Activity, Wallet } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { fetcher } from '@/lib/fetcher';
import type { BotHealth, WalletBalance } from '@/types';

export function Header() {
  const { data: session } = useSession();
  const { data: health } = useSWR<BotHealth>('/api/health', fetcher, { refreshInterval: 15_000 });
  const { data: balance } = useSWR<WalletBalance>('/api/wallet/balance', fetcher, {
    refreshInterval: 30_000,
  });

  const statusClass =
    health?.status === 'RUNNING'
      ? 'status-running'
      : health?.status === 'DRY_RUN'
        ? 'status-dryrun'
        : 'status-halted';

  const statusLabel = health?.status ?? 'UNKNOWN';

  return (
    <header className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-bold text-white">Overview</h1>
        <span className={statusClass}>
          <Activity className="h-3 w-3" />
          {statusLabel}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-400" title={session?.user?.walletAddress ? `Wallet: ${session.user.walletAddress}` : undefined}>
          <Wallet className="h-4 w-4" />
          <span className="font-medium text-slate-200">
            {balance?.sol?.toFixed(4) ?? '—'} SOL
          </span>
        </div>
        <div className="h-4 w-px bg-card-border" />
        <span className="text-sm text-slate-400">{session?.user?.displayName}</span>
      </div>
    </header>
  );
}
