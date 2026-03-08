'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Search, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlowNumber } from '@/components/ui/GlowNumber';
import { fetcher } from '@/lib/fetcher';
import type { PositionHistoryResponse } from '@/types';

function formatDuration(ms: number) {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function formatDurationMin(min: number) {
  if (min < 60) return `${min.toFixed(1)}m`;
  const h = min / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function ExitReasonBadge({ reason }: { reason: string }) {
  const r = reason.toLowerCase();
  const style =
    r === 'stop_loss'
      ? 'bg-red-500/20 text-red-400'
      : r === 'trailing_stop'
        ? 'bg-amber-500/20 text-amber-400'
        : r.includes('tp')
          ? 'bg-emerald-500/20 text-emerald-400'
          : 'bg-slate-500/20 text-slate-400';
  const icon =
    r === 'stop_loss' ? '🔴' : r === 'trailing_stop' ? '🟡' : r.includes('tp') ? '🟢' : '⚪';
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${style}`}>
      {icon} {reason}
    </span>
  );
}

export default function PositionsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [token, setToken] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status) params.set('status', status);
  if (token) params.set('token', token);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data: health } = useSWR<{ status: string }>('/api/health', fetcher, { refreshInterval: 10_000 });
  const isDryRun = health?.status === 'DRY_RUN';

  const { data: drySummary } = useSWR(
    isDryRun ? '/api/positions/dry-run/summary' : null,
    fetcher,
    { refreshInterval: 10_000 },
  );
  const { data: dryOpen } = useSWR(
    isDryRun ? '/api/positions/dry-run/open' : null,
    fetcher,
    { refreshInterval: 10_000 },
  );
  const { data: dryClosed } = useSWR(
    isDryRun ? '/api/positions/dry-run/closed' : null,
    fetcher,
    { refreshInterval: 10_000 },
  );

  const { data } = useSWR<PositionHistoryResponse>(
    `/api/positions/history?${params}`,
    fetcher,
    { refreshInterval: 30_000 },
  );

  const positions = data?.positions ?? [];
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20));
  const summary = data?.summary;

  const openPositions = dryOpen?.positions ?? [];
  const closedPositions = dryClosed?.positions ?? [];

  return (
    <DashboardShell>
      <h1 className="mb-6 text-lg font-bold text-white">Posições</h1>

      {isDryRun && drySummary && (
        <>
          <div className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-slate-300">Dry Run — Resumo</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Capital Total', val: drySummary.totalCapitalSOL, dec: 2, suffix: ' SOL', neutral: true },
                { label: 'Capital em Uso', val: drySummary.capitalInUse, dec: 4, suffix: ` SOL (${drySummary.capitalInUsePct?.toFixed(1) ?? 0}%)`, neutral: true },
                { label: 'Disponível', val: drySummary.availableCapital, dec: 4, suffix: ' SOL', neutral: true },
                { label: 'P&L Simulado', val: drySummary.totalPnlSOL, dec: 4, suffix: ' SOL' },
                { label: 'Win Rate', val: drySummary.winRate, dec: 1, suffix: '%', neutral: true },
                { label: 'Melhor Trade', val: drySummary.bestTrade, dec: 2, suffix: '%' },
                { label: 'Pior Trade', val: drySummary.worstTrade, dec: 2, suffix: '%' },
                { label: 'Hold Médio', val: drySummary.avgHoldMin, dec: 1, suffix: ' min', neutral: true },
              ].map((s) => (
                <GlassCard key={s.label} className="py-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{s.label}</p>
                  <div className="mt-1 text-lg font-bold">
                    <GlowNumber value={s.val} decimals={s.dec} suffix={s.suffix} neutral={s.neutral} />
                  </div>
                </GlassCard>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-slate-300">Posições Abertas (atualiza 10s)</h2>
            <GlassCard className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-card-border text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2 font-medium">Token</th>
                      <th className="px-3 py-2 font-medium">Alocado (SOL)</th>
                      <th className="px-3 py-2 font-medium">Preço Entrada</th>
                      <th className="px-3 py-2 font-medium">Preço Atual</th>
                      <th className="px-3 py-2 font-medium text-right">P&L%</th>
                      <th className="px-3 py-2 font-medium text-right">P&L SOL</th>
                      <th className="px-3 py-2 font-medium">Stop / TP1 / Trail</th>
                      <th className="px-3 py-2 font-medium">Tempo Aberto</th>
                      <th className="px-3 py-2 font-medium">Estratégia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPositions.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-5 py-6 text-center text-slate-500">
                          Nenhuma posição aberta
                        </td>
                      </tr>
                    ) : (
                      openPositions.map((p) => {
                        const nearStop = p.stopLossPrice > 0 && p.currentPrice < p.stopLossPrice * 1.05;
                        const rowClass = p.currentPnlPct > 0
                          ? 'border-b border-card-border/50 bg-emerald-500/5'
                          : p.currentPnlPct < 0
                            ? 'border-b border-card-border/50 bg-red-500/5'
                            : 'border-b border-card-border/50';
                        const openMs = Date.now() - new Date(p.entryTime).getTime();
                        return (
                          <tr key={p.id} className={`${rowClass} ${nearStop ? 'animate-pulse' : ''}`}>
                            <td className="px-3 py-2">
                              <a
                                href={`https://solscan.io/token/${p.tokenMint}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-slate-300 hover:text-accent"
                              >
                                {p.tokenMint.slice(0, 8)}...
                              </a>
                            </td>
                            <td className="px-3 py-2 tabular-nums text-slate-300">{p.amountSOL.toFixed(4)}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-400">{p.entryPrice.toFixed(9)}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-400">{p.currentPrice.toFixed(9)}</td>
                            <td className="px-3 py-2 text-right">
                              <GlowNumber value={p.currentPnlPct} suffix="%" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <GlowNumber value={p.currentPnlSOL} decimals={4} suffix=" SOL" />
                            </td>
                            <td className="px-3 py-2 text-[10px] text-slate-500">
                              {p.stopLossPrice.toFixed(6)} / {p.tp1Price.toFixed(6)} / {p.trailingStopPrice?.toFixed(6) ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-400">{formatDuration(openMs)}</td>
                            <td className="px-3 py-2 text-slate-400">{p.strategy}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </div>

          <div className="mb-8">
            <h2 className="mb-3 text-sm font-semibold text-slate-300">Histórico de Fechamentos</h2>
            <GlassCard className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-card-border text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2 font-medium">Token</th>
                      <th className="px-3 py-2 font-medium">Alocado</th>
                      <th className="px-3 py-2 font-medium">Entrada</th>
                      <th className="px-3 py-2 font-medium">Saída</th>
                      <th className="px-3 py-2 font-medium text-right">P&L%</th>
                      <th className="px-3 py-2 font-medium text-right">P&L SOL</th>
                      <th className="px-3 py-2 font-medium">Motivo</th>
                      <th className="px-3 py-2 font-medium">Duração</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedPositions.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-6 text-center text-slate-500">
                          Nenhum fechamento ainda
                        </td>
                      </tr>
                    ) : (
                      closedPositions.map((p) => {
                        const durMs = new Date(p.exitTime).getTime() - new Date(p.entryTime).getTime();
                        return (
                          <tr key={p.id} className="border-b border-card-border/50 hover:bg-white/[0.02]">
                            <td className="px-3 py-2">
                              <a
                                href={`https://solscan.io/token/${p.tokenMint}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-slate-300 hover:text-accent"
                              >
                                {p.tokenMint.slice(0, 8)}...
                              </a>
                            </td>
                            <td className="px-3 py-2 tabular-nums text-slate-400">{p.amountSOL.toFixed(4)} SOL</td>
                            <td className="px-3 py-2 tabular-nums text-slate-400">{p.entryPrice.toFixed(9)}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-400">{p.exitPrice.toFixed(9)}</td>
                            <td className="px-3 py-2 text-right">
                              <GlowNumber value={p.finalPnlPct} suffix="%" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <GlowNumber value={p.finalPnlSOL} decimals={4} suffix=" SOL" />
                            </td>
                            <td className="px-3 py-2">
                              <ExitReasonBadge reason={p.exitReason} />
                            </td>
                            <td className="px-3 py-2 text-slate-400">{formatDurationMin(durMs / 60_000)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </div>

          <h2 className="mb-3 text-sm font-semibold text-slate-300">Histórico Real (Prisma)</h2>
        </>
      )}

      {summary && !isDryRun && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Total Trades', val: summary.totalTrades, dec: 0, neutral: true },
            { label: 'Win Rate', val: summary.winRate, dec: 1, suffix: '%', neutral: true },
            { label: 'Avg Win', val: summary.avgWin, dec: 2, suffix: '%' },
            { label: 'Avg Loss', val: summary.avgLoss, dec: 2, suffix: '%' },
            { label: 'Melhor', val: summary.bestTrade, dec: 2, suffix: '%' },
            { label: 'Pior', val: summary.worstTrade, dec: 2, suffix: '%' },
          ].map((s) => (
            <GlassCard key={s.label} className="py-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{s.label}</p>
              <div className="mt-1 text-lg font-bold">
                <GlowNumber
                  value={s.val}
                  decimals={s.dec}
                  suffix={s.suffix}
                  neutral={s.neutral}
                />
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      <GlassCard className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
              Token
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
              <input
                type="text"
                value={token}
                onChange={(e) => { setToken(e.target.value); setPage(1); }}
                placeholder="Buscar mint/symbol"
                className="w-48 rounded-lg border border-card-border bg-white/5 py-2 pl-8 pr-3 text-xs text-white placeholder-slate-600 outline-none focus:border-accent"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="rounded-lg border border-card-border bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-accent"
            >
              <option value="">Todos</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="stuck">Stuck</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
              De
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(1); }}
              className="rounded-lg border border-card-border bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
              Até
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPage(1); }}
              className="rounded-lg border border-card-border bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-accent"
            />
          </div>
        </div>
      </GlassCard>

      <GlassCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-card-border text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3 font-medium">Token</th>
                <th className="px-3 py-3 font-medium">Buy Price</th>
                <th className="px-3 py-3 font-medium">Sell Price</th>
                <th className="px-3 py-3 font-medium text-right">P&L%</th>
                <th className="px-3 py-3 font-medium text-right">P&L SOL</th>
                <th className="px-3 py-3 font-medium">Score</th>
                <th className="px-3 py-3 font-medium">Hold Time</th>
                <th className="px-3 py-3 font-medium">Exit Reason</th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-600">
                    Nenhum registro encontrado
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
                      <span className="font-medium text-slate-200">
                        {p.symbol || p.tokenMint.slice(0, 6)}
                      </span>
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
                    {p.exitPrice?.toFixed(9) ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <GlowNumber value={p.pnlPercent} suffix="%" />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <GlowNumber value={p.pnlSol} decimals={4} suffix=" SOL" />
                  </td>
                  <td className="px-3 py-3 text-slate-400">{p.strategyId || '—'}</td>
                  <td className="px-3 py-3 text-slate-400">{formatDuration(p.holdTime)}</td>
                  <td className="px-3 py-3">
                    <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                      {p.exitReason}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-card-border px-5 py-3">
            <span className="text-xs text-slate-500">
              Página {page} de {totalPages} ({data?.total ?? 0} registros)
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-card-border p-1.5 text-slate-400 hover:bg-white/5 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-card-border p-1.5 text-slate-400 hover:bg-white/5 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </GlassCard>
    </DashboardShell>
  );
}
