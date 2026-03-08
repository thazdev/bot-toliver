'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { RefreshCw, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { Header } from '@/components/layout/Header';
import { GlassCard } from '@/components/ui/GlassCard';
import { fetcher } from '@/lib/fetcher';
import { useSocket } from '@/hooks/useSocket';
import { useEffect } from 'react';
import type { DiagnosticsResponse } from '@/app/api/diagnostics/route';

type EventFilter = 'all' | 'trades' | 'rejected' | 'errors';

interface FeedEvent {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

function PipelineFunnel({ data }: { data: DiagnosticsResponse['pipeline'] }) {
  const total = data.tokens_received || 1;
  const s1 = data.tokens_received - data.stage1.total;
  const s2 = data.stage2.passed;
  const s3Entries = data.stage3_entries;
  const s3 = s3Entries - (data.stage4 + data.stage5 + data.stage6);
  const passed = data.passed;

  const steps = [
    { label: 'Detectados', value: data.tokens_received, pct: 100 },
    { label: 'S1', value: s1, pct: total ? (s1 / total) * 100 : 0 },
    { label: 'S2', value: s2, pct: total ? (s2 / total) * 100 : 0 },
    { label: 'S3', value: s3Entries, pct: total ? (s3Entries / total) * 100 : 0 },
    { label: 'S4', value: s3, pct: total ? (s3 / total) * 100 : 0 },
    { label: 'S5', value: s3, pct: total ? (s3 / total) * 100 : 0 },
    { label: 'S6', value: passed, pct: total ? (passed / total) * 100 : 0 },
    { label: '✅', value: passed, pct: total ? (passed / total) * 100 : 0 },
  ];

  const getBarColor = (pct: number) => {
    if (pct >= 70) return 'bg-success';
    if (pct >= 40) return 'bg-warning';
    return 'bg-danger';
  };

  return (
    <div className="flex flex-wrap items-end gap-1">
      {steps.map((step, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <div
            className="h-12 min-w-[48px] rounded-t transition-all"
            style={{
              width: `${Math.max(48, step.pct * 2)}px`,
              backgroundColor: step.label === '✅' ? 'var(--success)' : `rgba(99, 102, 241, ${0.3 + (step.pct / 100) * 0.5})`,
            }}
          />
          <span className="text-[10px] font-medium text-slate-400">{step.label}</span>
          <span className="text-xs font-semibold text-slate-200">{step.value}</span>
        </div>
      ))}
    </div>
  );
}

function Stage2Breakdown({ reasons }: { reasons: Record<string, number> }) {
  const entries = Object.entries(reasons).filter(([, v]) => v > 0);
  if (entries.length === 0) {
    return <p className="text-xs text-slate-500">Nenhuma rejeição no Stage 2</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([key, count]) => (
        <div
          key={key}
          className="rounded-lg border border-card-border bg-white/5 px-3 py-2 text-xs"
        >
          <span className="text-slate-400">{key}:</span>{' '}
          <span className="font-semibold text-slate-200">{count}</span>
        </div>
      ))}
    </div>
  );
}

function getBlockReasonShort(reason?: string): string {
  if (!reason) return 'unknown';
  const r = reason.toLowerCase();
  if (r.includes('no_buy_signal') || r.includes('sem_sinal')) return 'sem sinal de compra';
  if (r.includes('insufficient') || r.includes('capital') || r.includes('balance') || r.includes('saldo')) return 'saldo insuficiente';
  if (r.includes('max_positions') || r.includes('max positions')) return 'max posições atingido';
  if (r.includes('daily_loss') || r.includes('daily risk') || r.includes('daily loss')) return 'daily loss';
  if (r.includes('exposure') || r.includes('exceed max')) return 'exposição excedida';
  if (r.includes('circuit_breaker') || r.includes('circuit breaker') || r.includes('tripped')) return 'circuit breaker';
  if (r.includes('cooldown')) return 'cooldown';
  if (r.includes('already_have') || r.includes('already have') || r.includes('open position')) return 'posição já aberta';
  if (r.includes('position_size_too_large')) return 'position size too large';
  if (r.includes('same_dev_wallet')) return 'same dev wallet';
  if (r.includes('risk_check_exception')) return 'risk check exception';
  if (r.includes('riskcheck_returned_no_reason')) return 'riskcheck returned no reason';
  return reason.length > 35 ? `${reason.slice(0, 32)}…` : reason;
}

function PassedTokensTable({ tokens }: { tokens: DiagnosticsResponse['last_passed_tokens'] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-card-border text-[10px] uppercase tracking-wider text-slate-500">
            <th className="pb-2 pr-2 text-left">Mint</th>
            <th className="pb-2 pr-2 text-right">Entry</th>
            <th className="pb-2 pr-2 text-right">Liq.</th>
            <th className="pb-2 pr-2 text-right">Holders</th>
            <th className="pb-2 pr-2 text-center">Buy Signal</th>
            <th className="pb-2 pr-2 text-center">Trade</th>
            <th className="pb-2 text-left">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t, i) => (
            <tr
              key={`${t.mint}-${i}`}
              className="border-b border-card-border/50 transition-colors hover:bg-white/[0.02]"
            >
              <td className="py-2 pr-2 font-mono text-slate-300">
                {t.mint ? `${t.mint.slice(0, 6)}...${t.mint.slice(-4)}` : '-'}
              </td>
              <td className="py-2 pr-2 text-right text-slate-300">{t.entryScore.toFixed(1)}</td>
              <td className="py-2 pr-2 text-right text-slate-300">{t.liquidity.toFixed(2)}</td>
              <td className="py-2 pr-2 text-right text-slate-300">{t.holders}</td>
              <td className="py-2 pr-2 text-center">
                {t.hasBuySignal ? (
                  <span className="text-success">✅</span>
                ) : (
                  <span className="text-slate-500" title={t.skipReasons.join(', ')}>
                    ❌ {t.skipReasons[0] ?? '—'}
                  </span>
                )}
              </td>
              <td className="py-2 pr-2 text-center">
                {t.tradeExecuted ? (
                  <span className="text-accent" title="DRY RUN">
                    🔵 DRY RUN
                  </span>
                ) : t.hasBuySignal ? (
                  <span className="text-warning" title={t.tradeBlockReason ?? 'bloqueado'}>
                    ❌ bloqueado ({getBlockReasonShort(t.tradeBlockReason)})
                  </span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </td>
              <td className="py-2 text-slate-500">
                {t.timestamp ? new Date(t.timestamp).toLocaleTimeString('pt-BR') : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiagnosticsEventFeed({ filter }: { filter: EventFilter }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;
    const handler = (ev: FeedEvent) => {
      setEvents((prev) => [ev, ...prev].slice(0, 100));
    };
    socket.on('trade_executed', handler);
    socket.on('bot_event', handler);
    socket.on('alert', handler);
    return () => {
      socket.off('trade_executed', handler);
      socket.off('bot_event', handler);
      socket.off('alert', handler);
    };
  }, [socket]);

  const filtered = events.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'trades') return e.type === 'buy' || e.type === 'sell' || e.type === 'DRY_RUN_TRADE';
    if (filter === 'rejected') return e.type?.toLowerCase().includes('reject');
    if (filter === 'errors') return e.type?.toLowerCase().includes('error');
    return true;
  });

  return (
    <div className="space-y-2">
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="py-4 text-center text-xs text-slate-600">Aguardando eventos…</p>
        )}
        {filtered.map((ev) => (
          <div
            key={ev.id}
            className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-white/[0.03]"
          >
            {ev.type === 'DRY_RUN_TRADE' ? (
              <span className="text-accent">🔵</span>
            ) : ev.type === 'buy' ? (
              <span className="text-success">↓</span>
            ) : ev.type === 'sell' ? (
              <span className="text-warning">↑</span>
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-slate-500" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-slate-300">{ev.message}</p>
              <p className="text-[10px] text-slate-600">
                {new Date(ev.timestamp).toLocaleTimeString('pt-BR')}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DiagnosticsPage() {
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const { data, error, mutate, isLoading } = useSWR<DiagnosticsResponse>(
    '/api/diagnostics',
    fetcher,
    { refreshInterval: 10_000 }
  );

  return (
    <DashboardShell>
      <Header />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Bot Diagnostics</h1>
          <p className="text-xs text-slate-500">
            Última atualização: {data?.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString('pt-BR') : '—'}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          disabled={isLoading}
          className="flex items-center gap-2 rounded-xl border border-card-border bg-white/5 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <XCircle className="h-5 w-5 shrink-0" />
          Erro ao carregar: {error.message}
        </div>
      )}

      {data?.redisError && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {data.redisError}
        </div>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-slate-500" />
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* ROW 1 — Pipeline Funnel */}
          <GlassCard>
            <h3 className="mb-4 text-sm font-semibold text-slate-300">Funil do Pipeline</h3>
            <PipelineFunnel data={data.pipeline} />
          </GlassCard>

          {/* ROW 2 — Stage 2 Breakdown */}
          <GlassCard>
            <h3 className="mb-4 text-sm font-semibold text-slate-300">Breakdown Stage 2 (rejeições)</h3>
            <Stage2Breakdown reasons={data.pipeline.stage2.reasons} />
          </GlassCard>

          {/* ROW 3 — Passed Tokens Table */}
          <GlassCard>
            <h3 className="mb-4 text-sm font-semibold text-slate-300">
              Tokens que passaram o pipeline (últimos 50)
            </h3>
            <PassedTokensTable tokens={data.last_passed_tokens} />
          </GlassCard>

          {/* ROW 4 — Event Feed */}
          <GlassCard>
            <h3 className="mb-4 text-sm font-semibold text-slate-300">Feed de eventos em tempo real</h3>
            <div className="flex gap-2 mb-3">
              {(['all', 'trades', 'rejected', 'errors'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setEventFilter(f)}
                  className={`rounded px-3 py-1.5 text-xs ${
                    eventFilter === f
                      ? 'bg-accent/30 text-accent'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'trades' ? 'Trades' : f === 'rejected' ? 'Rejected' : 'Errors'}
                </button>
              ))}
            </div>
            <DiagnosticsEventFeed filter={eventFilter} />
          </GlassCard>
        </div>
      )}
    </DashboardShell>
  );
}
