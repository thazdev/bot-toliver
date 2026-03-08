'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  ArrowUpDown,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ReceiptText,
} from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { fetcher } from '@/lib/fetcher';

interface Trade {
  id: number;
  tokenMint: string;
  direction: 'buy' | 'sell';
  amountSol: number;
  status: string;
  dryRun: boolean;
  executedAt: string;
  pnlSol?: number;
  pnlPct?: number;
  exitReason?: string;
  txSignature?: string;
}

interface TradesResponse {
  trades: Trade[];
  total: number;
  page: number;
}

type ModeFilter = 'all' | 'dry-run' | 'real';

function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month} ${hours}:${mins}`;
}

const LIMIT = 20;

const modeOptions: { label: string; value: ModeFilter }[] = [
  { label: 'Todos', value: 'all' },
  { label: 'Dry-Run', value: 'dry-run' },
  { label: 'Real', value: 'real' },
];

export default function TradesPage() {
  const [page, setPage] = useState(1);
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [tokenFilter, setTokenFilter] = useState('');

  const params = new URLSearchParams({
    page: String(page),
    limit: String(LIMIT),
  });
  if (modeFilter !== 'all') params.set('mode', modeFilter);
  if (tokenFilter) params.set('token', tokenFilter);

  const { data, isLoading } = useSWR<TradesResponse>(
    `/api/trades?${params}`,
    fetcher,
    { refreshInterval: 10_000 },
  );

  const trades = data?.trades ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const hasFilters = modeFilter !== 'all' || tokenFilter !== '';

  function clearFilters() {
    setModeFilter('all');
    setTokenFilter('');
    setPage(1);
  }

  return (
    <DashboardShell>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <ArrowUpDown className="h-5 w-5 text-accent" />
          <div>
            <h1 className="text-lg font-bold text-white">Trades</h1>
            <p className="text-xs text-slate-500">
              {total} trade{total !== 1 ? 's' : ''} no total
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          {modeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setModeFilter(opt.value); setPage(1); }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                modeFilter === opt.value
                  ? 'bg-accent text-white'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={tokenFilter}
            onChange={(e) => { setTokenFilter(e.target.value); setPage(1); }}
            placeholder="Filtrar por token..."
            className="w-52 rounded-lg border border-card-border bg-white/5 py-1.5 pl-8 pr-3 text-sm text-white placeholder-slate-500 outline-none focus:border-accent"
          />
        </div>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/10"
          >
            <X className="h-3 w-3" />
            Limpar filtros
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-white/5 text-xs uppercase text-slate-500">
                <th className="px-4 py-3 font-medium">Data/Hora</th>
                <th className="px-4 py-3 font-medium">Token</th>
                <th className="px-4 py-3 font-medium">Ação</th>
                <th className="px-4 py-3 font-medium text-right">Quantidade SOL</th>
                <th className="px-4 py-3 font-medium text-right">P&L SOL</th>
                <th className="px-4 py-3 font-medium text-right">P&L %</th>
                <th className="px-4 py-3 font-medium">Modo</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && trades.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    Carregando...
                  </td>
                </tr>
              )}

              {!isLoading && trades.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <ReceiptText className="h-8 w-8 text-slate-600" />
                      <span className="text-sm text-slate-500">Nenhum trade encontrado</span>
                    </div>
                  </td>
                </tr>
              )}

              {trades.map((t) => {
                const isDry = t.dryRun;
                const rowBorder = isDry ? 'border-l-2 border-l-blue-500' : '';
                const rowBg = isDry ? 'bg-blue-500/5' : '';
                const pnlColor = (val?: number) =>
                  val == null ? 'text-slate-500' : val > 0 ? 'text-emerald-400' : val < 0 ? 'text-red-400' : 'text-slate-400';

                return (
                  <tr
                    key={t.id}
                    className={`border-b border-card-border hover:bg-white/5 transition-colors ${rowBorder} ${rowBg}`}
                  >
                    <td className="px-4 py-3 tabular-nums text-slate-400">
                      {formatDate(t.executedAt)}
                    </td>

                    <td className="px-4 py-3">
                      <a
                        href={`https://solscan.io/token/${t.tokenMint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-slate-300 hover:text-accent"
                      >
                        {t.tokenMint.slice(0, 8)}...
                        <ExternalLink className="h-3 w-3 text-slate-600" />
                      </a>
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          t.direction === 'buy'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {t.direction}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                      {t.amountSol.toFixed(4)}
                    </td>

                    <td className={`px-4 py-3 text-right tabular-nums ${pnlColor(t.pnlSol)}`}>
                      {t.pnlSol != null ? `${t.pnlSol >= 0 ? '+' : ''}${t.pnlSol.toFixed(4)}` : '—'}
                    </td>

                    <td className={`px-4 py-3 text-right tabular-nums ${pnlColor(t.pnlPct)}`}>
                      {t.pnlPct != null ? `${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%` : '—'}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          isDry
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-orange-500/20 text-orange-400'
                        }`}
                      >
                        {isDry ? 'DRY-RUN' : 'REAL'}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                        {t.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-card-border px-4 py-3">
            <span className="text-xs text-slate-500">
              Página {page} de {totalPages} ({total} registros)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-slate-400 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-slate-400 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                Próximo
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
