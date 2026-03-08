'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  StopCircle,
  PlayCircle,
  Settings,
  Shield,
  Activity,
  Clock,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { fetcher } from '@/lib/fetcher';
import type { BotHealth } from '@/types';

interface BotConfig {
  version?: string;
  [key: string]: unknown;
}

type ToastState = { type: 'success' | 'error'; message: string } | null;

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatRelativeTime(iso: string | null) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s atrás`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m atrás`;
}

export default function ConfigPage() {
  const { data: health, mutate: mutateHealth } = useSWR<BotHealth>(
    '/api/health',
    fetcher,
    { refreshInterval: 5_000 },
  );

  const { data: botConfig } = useSWR<BotConfig>(
    '/api/settings/bot-config',
    fetcher,
    { refreshInterval: 10_000 },
  );

  const [togglingMode, setTogglingMode] = useState(false);
  const [confirmReal, setConfirmReal] = useState(false);
  const [stoppingBot, setStoppingBot] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [startingBot, setStartingBot] = useState(false);

  const [toast, setToast] = useState<ToastState>(null);

  const currentMode = health?.mode ?? 'dry-run';
  const isDryRun = currentMode === 'dry-run';
  const isRunning = health?.status === 'RUNNING' || health?.status === 'DRY_RUN';

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleToggleMode() {
    const targetMode = isDryRun ? 'real' : 'dry-run';

    if (targetMode === 'real' && !confirmReal) {
      setConfirmReal(true);
      return;
    }

    setConfirmReal(false);
    setTogglingMode(true);
    try {
      const res = await fetch('/api/bot/toggle-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: targetMode }),
      });
      if (!res.ok) throw new Error('Falha ao alternar modo');
      await mutateHealth();
      showToast('success', `Modo alterado para ${targetMode.toUpperCase()}`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao alternar modo');
    } finally {
      setTogglingMode(false);
    }
  }

  async function handleStopBot() {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }

    setConfirmStop(false);
    setStoppingBot(true);
    try {
      const res = await fetch('/api/bot/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Falha ao parar o bot');
      await mutateHealth();
      showToast('success', 'Bot parado com sucesso');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao parar bot');
    } finally {
      setStoppingBot(false);
    }
  }

  async function handleStartBot() {
    setStartingBot(true);
    try {
      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Falha ao iniciar o bot');
      await mutateHealth();
      showToast('success', 'Bot iniciado com sucesso');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao iniciar bot');
    } finally {
      setStartingBot(false);
    }
  }

  return (
    <DashboardShell>
      <div className="mb-6 flex items-center gap-3">
        <Settings className="h-6 w-6 text-indigo-400" />
        <h1 className="text-lg font-bold text-white">Configurações</h1>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium ${
            toast.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          {toast.message}
        </div>
      )}

      {/* Bot Control */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Controle do Bot
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Mode Toggle Card */}
          <div className="rounded-2xl border border-card-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Modo de Operação</h3>
            </div>

            <div className="mb-5 flex items-center justify-center">
              {isDryRun ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/20 px-6 py-2 text-lg font-bold text-blue-400">
                  <Zap className="h-5 w-5" />
                  DRY-RUN
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/20 px-6 py-2 text-lg font-bold text-orange-400">
                  <AlertTriangle className="h-5 w-5" />
                  REAL
                </span>
              )}
            </div>

            {confirmReal && (
              <div className="mb-4 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-center text-sm text-orange-300">
                <AlertTriangle className="mb-1 inline h-4 w-4" /> Tem certeza? Isso vai operar com
                SOL real.
              </div>
            )}

            <button
              onClick={handleToggleMode}
              disabled={togglingMode}
              className={`w-full rounded-xl px-4 py-3 font-semibold transition-colors ${
                isDryRun
                  ? 'border border-orange-500/30 bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
                  : 'border border-blue-500/30 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
              } disabled:opacity-50`}
            >
              {togglingMode
                ? 'Alternando...'
                : confirmReal
                  ? 'Confirmar mudança para REAL'
                  : isDryRun
                    ? 'Mudar para REAL'
                    : 'Mudar para DRY-RUN'}
            </button>

            {confirmReal && (
              <button
                onClick={() => setConfirmReal(false)}
                className="mt-2 w-full rounded-xl px-4 py-2 text-sm text-slate-400 transition-colors hover:text-white"
              >
                Cancelar
              </button>
            )}
          </div>

          {/* Emergency Stop Card */}
          <div className="rounded-2xl border border-card-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Controle do Bot</h3>
            </div>

            <div className="mb-4 flex items-center justify-center">
              <span
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-lg font-bold ${
                  isRunning
                    ? 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-400'
                    : 'border border-red-500/30 bg-red-500/20 text-red-400'
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${isRunning ? 'animate-pulse bg-emerald-400' : 'bg-red-400'}`}
                />
                {isRunning ? 'RUNNING' : 'STOPPED'}
              </span>
            </div>

            {health?.uptimeSeconds != null && isRunning && (
              <p className="mb-4 text-center text-xs text-slate-400">
                <Clock className="mr-1 inline h-3.5 w-3.5" />
                Rodando há {formatUptime(health.uptimeSeconds)}
              </p>
            )}

            {confirmStop && (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
                <AlertTriangle className="mb-1 inline h-4 w-4" /> Tem certeza que deseja parar o
                bot?
              </div>
            )}

            <div className="flex flex-col gap-2">
              {isRunning ? (
                <>
                  <button
                    onClick={handleStopBot}
                    disabled={stoppingBot}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/20 px-4 py-3 font-semibold text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                  >
                    <StopCircle className="h-5 w-5" />
                    {stoppingBot
                      ? 'Parando...'
                      : confirmStop
                        ? 'Confirmar — PARAR BOT'
                        : 'PARAR BOT'}
                  </button>
                  {confirmStop && (
                    <button
                      onClick={() => setConfirmStop(false)}
                      className="w-full rounded-xl px-4 py-2 text-sm text-slate-400 transition-colors hover:text-white"
                    >
                      Cancelar
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={handleStartBot}
                  disabled={startingBot}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/20 px-4 py-3 font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  <PlayCircle className="h-5 w-5" />
                  {startingBot ? 'Iniciando...' : 'INICIAR BOT'}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Connection Status */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Status da Conexão
        </h2>
        <div className="rounded-2xl border border-card-border bg-card p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Bot Status
              </p>
              <div className="mt-1">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${
                    isRunning
                      ? 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-400'
                      : 'border border-red-500/30 bg-red-500/20 text-red-400'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-red-400'}`}
                  />
                  {health?.status ?? 'UNKNOWN'}
                </span>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Modo</p>
              <div className="mt-1">
                {isDryRun ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/20 px-3 py-1 text-sm font-bold text-blue-400">
                    DRY-RUN
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-500/20 px-3 py-1 text-sm font-bold text-orange-400">
                    REAL
                  </span>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Last Heartbeat
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {formatRelativeTime(health?.lastHeartbeat ?? null)}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Uptime</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {health?.uptimeSeconds != null ? formatUptime(health.uptimeSeconds) : '—'}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Versão</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {botConfig?.version ?? '—'}
              </p>
            </div>
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}
