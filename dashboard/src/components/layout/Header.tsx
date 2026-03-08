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

  const { data: health } = useSWR<BotHealth>('/api/health', fetcher, { refreshInterval: 5_000 });
  const { data: balance, error: balanceError } = useSWR<WalletBalance>(
    '/api/wallet/balance',
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
      errorRetryCount: 2,
      dedupingInterval: 30_000,
    },
  );

  useEffect(() => {
    if (balance && !balanceError && balance.sol != null) {
      if (balance.sol > 0 || cachedSol == null) {
        setCachedSol(balance.sol);
        try {
          sessionStorage.setItem(BALANCE_CACHE_KEY, String(balance.sol));
        } catch {}
      }
    }
  }, [balance, balanceError, cachedSol]);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(BALANCE_CACHE_KEY);
      if (stored) setCachedSol(parseFloat(stored));
    } catch {}
  }, []);

  const displaySol = balance?.sol ?? cachedSol;

  const statusColor =
    health?.status === 'RUNNING' ? 'bg-success/20 text-success border-success/30'
    : health?.status === 'DRY_RUN' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    : health?.status === 'HALTED' ? 'bg-danger/20 text-danger border-danger/30'
    : 'bg-slate-500/20 text-slate-400 border-slate-500/30';

  const modeColor = health?.mode === 'real'
    ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    : 'bg-blue-500/20 text-blue-400 border-blue-500/30';

  return (
    <header className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-white">Dashboard</h1>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusColor}`}>
          <Activity className="h-3 w-3" />
          {health?.status ?? 'UNKNOWN'}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${modeColor}`}>
          {health?.mode === 'real' ? 'REAL' : 'DRY-RUN'}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Wallet className="h-4 w-4 shrink-0" />
          <span className="font-medium text-slate-200">
            {displaySol != null ? `${displaySol.toFixed(4)} SOL` : balanceError ? 'Erro' : '\u2014'}
          </span>
        </div>
        <div className="h-4 w-px bg-card-border" />
        <span className="text-sm text-slate-400">{session?.user?.displayName}</span>
      </div>
    </header>
  );
}
