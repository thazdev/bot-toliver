'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { ExternalLink, X } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlowNumber } from '@/components/ui/GlowNumber';
import { fetcher } from '@/lib/fetcher';
import type { OpenPosition } from '@/types';

function timeSince(dateStr: string) {
  const ms = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function OpenPositionsTable() {
  const { data, mutate } = useSWR<OpenPosition[]>('/api/positions/open', fetcher, {
    refreshInterval: 10_000,
  });
  const [exitingId, setExitingId] = useState<string | null>(null);

  const positions = data ?? [];

  async function handleForceExit(id: string) {
    if (!confirm('Confirma force exit desta posição?')) return;
    setExitingId(id);
    try {
      await fetch(`/api/positions/${id}/force-exit`, { method: 'POST' });
      mutate();
    } finally {
      setExitingId(null);
    }
  }

  return (
    <GlassCard className="col-span-full overflow-hidden p-0">
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-sm font-semibold text-slate-300">Posições Abertas</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-card-border text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-5 py-2.5 font-medium">Token</th>
              <th className="px-3 py-2.5 font-medium">Entry Price</th>
              <th className="px-3 py-2.5 font-medium">Current Price</th>
              <th className="px-3 py-2.5 font-medium text-right">P&L%</th>
              <th className="px-3 py-2.5 font-medium text-right">P&L SOL</th>
              <th className="px-3 py-2.5 font-medium">Tempo</th>
              <th className="px-3 py-2.5 font-medium">Tier</th>
              <th className="px-3 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-slate-600">
                  Nenhuma posição aberta
                </td>
              </tr>
            )}
            {positions.map((p) => (
              <tr
                key={p.id}
                className="border-b border-card-border/50 transition-colors hover:bg-white/[0.02]"
              >
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-200">{p.symbol || p.tokenMint.slice(0, 6)}</span>
                    <a
                      href={`https://solscan.io/token/${p.tokenMint}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-600 hover:text-accent"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </td>
                <td className="px-3 py-3 tabular-nums text-slate-400">
                  {p.entryPrice.toFixed(9)}
                </td>
                <td className="px-3 py-3 tabular-nums text-slate-400">
                  {p.currentPrice.toFixed(9)}
                </td>
                <td className="px-3 py-3 text-right">
                  <GlowNumber value={p.pnlPercent} suffix="%" />
                </td>
                <td className="px-3 py-3 text-right">
                  <GlowNumber value={p.pnlSol} decimals={4} suffix=" SOL" />
                </td>
                <td className="px-3 py-3 text-slate-400">{timeSince(p.openedAt)}</td>
                <td className="px-3 py-3">
                  <span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                    {p.strategyId || 'default'}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <button
                    onClick={() => handleForceExit(p.id)}
                    disabled={exitingId === p.id}
                    className="flex items-center gap-1 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1 text-[10px] font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                    Force Exit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
