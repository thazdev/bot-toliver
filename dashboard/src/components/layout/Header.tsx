'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Activity, Wallet } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { fetcher } from '@/lib/fetcher';
import type { BotHealth, WalletBalance } from '@/types';

const BALANCE_CACHE_KEY = 'toliver:last_balance';

export function Header() {
  const { data: session } = useSession();
  const [cachedSol, setCachedSol] = useState<number | null>(null);

  const { data: health } = useSWR<BotHealth>('/api/health', fetcher, { refreshInterval: 15_000 });
  const { data: balance, error: balanceError, isLoading } = useSWR<WalletBalance>(
    '/api/wallet/balance',
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: false,
      errorRetryCount: 3,
      dedupingInterval: 10_000,
    },
  );

  useEffect(() => {
    if (balance?.sol != null) {
      setCachedSol(balance.sol);
      try {
        sessionStorage.setItem(BALANCE_CACHE_KEY, String(balance.sol));
      } catch {}
    }
  }, [balance?.sol]);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(BALANCE_CACHE_KEY);
      if (stored) setCachedSol(parseFloat(stored));
    } catch {}
  }, []);

  const displaySol = balance?.sol ?? cachedSol;

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
          <Wallet className="h-4 w-4 shrink-0" />
          <span className="font-medium text-slate-200">
            {balanceError ? 'Erro' : displaySol != null ? `${displaySol.toFixed(4)} SOL` : '—'}
          </span>
        </div>
        <div className="h-4 w-px bg-card-border" />
        <span className="text-sm text-slate-400">{session?.user?.displayName}</span>
      </div>
    </header>
  );
}
