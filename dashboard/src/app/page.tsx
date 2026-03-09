'use client';

import useSWR from 'swr';
import clsx from 'clsx';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Wallet,
  Clock,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { Header } from '@/components/layout/Header';
import { fetcher } from '@/lib/fetcher';
import type {
  BotHealth,
  OpenPosition,
  DryRunOpenPosition,
  DryRunClosedPosition,
  PositionHistoryResponse,
} from '@/types';

interface Stats {
  pnlToday: number;
  pnlTodayPercent: number;
  totalCapital: number;
  availableCapital: number;
  tradesToday: number;
  winRate: number;
}

function truncateMint(mint: string) {
  if (mint.length <= 10) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function formatTimeSince(isoDate: string) {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function formatTimestamp(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function KpiCard({
  title,
  value,
  color = 'text-white',
}: {
  title: string;
  value: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {title}
      </p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export default function OverviewPage() {
  const { data: health } = useSWR<BotHealth>('/api/health', fetcher, {
    refreshInterval: 3_000,
  });

  const { data: stats } = useSWR<Stats>('/api/stats', fetcher, {
    refreshInterval: 5_000,
  });

  const { data: openPositions } = useSWR<OpenPosition[]>(
    '/api/positions/open',
    fetcher,
    { refreshInterval: 10_000 },
  );

  const { data: dryRunData } = useSWR<{ positions: DryRunOpenPosition[] }>(
    '/api/positions/dry-run/open',
    fetcher,
    { refreshInterval: 10_000 },
  );

  const { data: historyData } = useSWR<PositionHistoryResponse>(
    '/api/positions/history?pageSize=5',
    fetcher,
    { refreshInterval: 10_000 },
  );

  const { data: dryRunClosedData } = useSWR<{ positions: DryRunClosedPosition[] }>(
    '/api/positions/dry-run/closed',
    fetcher,
    { refreshInterval: 10_000 },
  );

  const dryRunPositions = dryRunData?.positions ?? [];
  const recentTrades = historyData?.positions ?? [];
  const dryRunClosed = dryRunClosedData?.positions ?? [];

  const botStopped =
    health && health.status !== 'RUNNING' && health.status !== 'DRY_RUN';

  const pnlToday = stats?.pnlToday ?? 0;
  const pnlTodayPct = stats?.pnlTodayPercent ?? 0;
  const pnlColor = pnlToday >= 0 ? 'text-emerald-400' : 'text-red-400';

  return (
    <DashboardShell>
      <Header />

      {/* Alert banner */}
      {botStopped && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Bot parado &mdash; nenhuma operação em andamento
        </div>
      )}

      {/* KPI Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          title="P&L Hoje"
          color={pnlColor}
          value={
            <span className="flex items-center gap-2">
              {pnlToday >= 0 ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
              {pnlToday >= 0 ? '+' : ''}
              {pnlToday.toFixed(4)} SOL
              <span className="text-base font-semibold opacity-70">
                ({pnlTodayPct >= 0 ? '+' : ''}
                {pnlTodayPct.toFixed(1)}%)
              </span>
            </span>
          }
        />

        <KpiCard
          title="Capital"
          value={
            <span className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-slate-400" />
              <span>
                {(stats?.totalCapital ?? 0).toFixed(2)}{' '}
                <span className="text-base font-semibold text-slate-400">
                  / {(stats?.availableCapital ?? 0).toFixed(2)} livre
                </span>
              </span>
            </span>
          }
        />

        <KpiCard
          title="Trades Hoje"
          value={
            <span className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-indigo-400" />
              {stats?.tradesToday ?? 0}
            </span>
          }
        />

        <KpiCard
          title="Win Rate"
          color={
            (stats?.winRate ?? 0) >= 50 ? 'text-emerald-400' : 'text-red-400'
          }
          value={`${(stats?.winRate ?? 0).toFixed(1)}%`}
        />

        <KpiCard
          title="Modo"
          value={
            health?.mode === 'real' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-500/20 px-3 py-0.5 text-sm font-bold text-orange-400">
                REAL
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/20 px-3 py-0.5 text-sm font-bold text-blue-400">
                DRY-RUN
              </span>
            )
          }
        />
      </div>

      {/* Open Positions */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Posições Abertas
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-card-border bg-card">
          {(openPositions?.length ?? 0) === 0 &&
          dryRunPositions.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-500">
              Nenhuma posição aberta
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-card-border text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Token</th>
                  <th className="px-4 py-3">Entry</th>
                  <th className="px-4 py-3">Current</th>
                  <th className="px-4 py-3">P&L %</th>
                  <th className="px-4 py-3">P&L SOL</th>
                  <th className="px-4 py-3">Tempo</th>
                  <th className="px-4 py-3">Modo</th>
                </tr>
              </thead>
              <tbody>
                {openPositions?.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-card-border/50 transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3">
                      <a
                        href={`https://solscan.io/token/${p.tokenMint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-indigo-400 hover:underline"
                      >
                        {p.symbol || truncateMint(p.tokenMint)}
                        <ExternalLink className="h-3 w-3 opacity-50" />
                      </a>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {p.entryPrice.toFixed(8)}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {p.currentPrice.toFixed(8)}
                    </td>
                    <td
                      className={clsx(
                        'px-4 py-3 font-semibold',
                        p.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400',
                      )}
                    >
                      {p.pnlPercent >= 0 ? '+' : ''}
                      {p.pnlPercent.toFixed(2)}%
                    </td>
                    <td
                      className={clsx(
                        'px-4 py-3 font-mono',
                        p.pnlSol >= 0 ? 'text-emerald-400' : 'text-red-400',
                      )}
                    >
                      {p.pnlSol >= 0 ? '+' : ''}
                      {p.pnlSol.toFixed(4)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {formatTimeSince(p.openedAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-orange-500/30 bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-400">
                        REAL
                      </span>
                    </td>
                  </tr>
                ))}

                {dryRunPositions.map((p) => (
                  <tr
                    key={`dry-${p.id}`}
                    className="border-b border-card-border/50 border-l-2 border-l-blue-500/40 transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3">
                      <a
                        href={`https://solscan.io/token/${p.tokenMint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-indigo-400 hover:underline"
                      >
                        {truncateMint(p.tokenMint)}
                        <ExternalLink className="h-3 w-3 opacity-50" />
                      </a>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {p.entryPrice.toFixed(8)}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {p.currentPrice.toFixed(8)}
                    </td>
                    <td
                      className={clsx(
                        'px-4 py-3 font-semibold',
                        p.currentPnlPct >= 0
                          ? 'text-emerald-400'
                          : 'text-red-400',
                      )}
                    >
                      {p.currentPnlPct >= 0 ? '+' : ''}
                      {p.currentPnlPct.toFixed(2)}%
                    </td>
                    <td
                      className={clsx(
                        'px-4 py-3 font-mono',
                        p.currentPnlSOL >= 0
                          ? 'text-emerald-400'
                          : 'text-red-400',
                      )}
                    >
                      {p.currentPnlSOL >= 0 ? '+' : ''}
                      {p.currentPnlSOL.toFixed(4)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {formatTimeSince(p.entryTime)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-blue-500/30 bg-blue-500/15 px-2 py-0.5 text-xs font-semibold text-blue-400">
                        DRY-RUN
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Recent Trades */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Últimos Trades
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-card-border bg-card">
          {recentTrades.length === 0 && dryRunClosed.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-500">
              Nenhum trade recente
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-card-border text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Token</th>
                  <th className="px-4 py-3">Ação</th>
                  <th className="px-4 py-3">Valor SOL</th>
                  <th className="px-4 py-3">P&L</th>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Modo</th>
                </tr>
              </thead>
              <tbody>
                {/* Real trades from positions table */}
                {recentTrades.map((t) => {
                  const isSell = t.exitPrice != null;
                  const profit = t.pnlSol > 0;

                  return (
                    <tr
                      key={t.id}
                      className="border-b border-card-border/50 transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3">
                        <a
                          href={`https://solscan.io/token/${t.tokenMint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-indigo-400 hover:underline"
                        >
                          {t.symbol || truncateMint(t.tokenMint)}
                          <ExternalLink className="h-3 w-3 opacity-50" />
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={clsx(
                            'rounded-full px-2 py-0.5 text-xs font-bold',
                            isSell
                              ? 'bg-amber-500/15 text-amber-400'
                              : 'bg-indigo-500/15 text-indigo-400',
                          )}
                        >
                          {isSell ? 'SELL' : 'BUY'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {Math.abs(t.pnlSol).toFixed(4)}
                      </td>
                      <td
                        className={clsx(
                          'px-4 py-3 font-semibold',
                          profit ? 'text-emerald-400' : 'text-red-400',
                        )}
                      >
                        {profit ? '+' : ''}
                        {t.pnlPercent.toFixed(2)}%
                        <span className="ml-1 text-xs opacity-70">
                          ({profit ? '+' : ''}
                          {t.pnlSol.toFixed(4)})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatTimestamp(t.closedAt ?? t.openedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-orange-500/30 bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-400">
                          REAL
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {/* Dry-run closed trades from Redis */}
                {dryRunClosed.slice(0, 10).map((t) => {
                  const profit = t.finalPnlSOL > 0;

                  return (
                    <tr
                      key={`dry-${t.id}`}
                      className="border-b border-card-border/50 border-l-2 border-l-blue-500/40 transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3">
                        <a
                          href={`https://solscan.io/token/${t.tokenMint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-indigo-400 hover:underline"
                        >
                          {truncateMint(t.tokenMint)}
                          <ExternalLink className="h-3 w-3 opacity-50" />
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-400">
                          SELL
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {t.amountSOL.toFixed(4)}
                      </td>
                      <td
                        className={clsx(
                          'px-4 py-3 font-semibold',
                          profit ? 'text-emerald-400' : 'text-red-400',
                        )}
                      >
                        {profit ? '+' : ''}
                        {t.finalPnlPct.toFixed(2)}%
                        <span className="ml-1 text-xs opacity-70">
                          ({profit ? '+' : ''}
                          {t.finalPnlSOL.toFixed(4)})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatTimestamp(t.exitTime)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-blue-500/30 bg-blue-500/15 px-2 py-0.5 text-xs font-semibold text-blue-400">
                          DRY-RUN
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </DashboardShell>
  );
}
