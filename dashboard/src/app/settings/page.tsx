'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { Save, Loader2, AlertTriangle, CheckCircle, Play, Pause } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { clsx } from 'clsx';
import { fetcher } from '@/lib/fetcher';
import type { StuckPosition } from '@/types';

export default function SettingsPage() {
  const { data: session, update: updateSession } = useSession();
  const [profile, setProfile] = useState({
    displayName: session?.user?.displayName ?? '',
    walletAddress: session?.user?.walletAddress ?? '',
    password: '',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const { data: botConfig, mutate: mutateBotConfig } = useSWR<Record<string, string>>(
    '/api/settings/bot-config',
    fetcher,
    { refreshInterval: 10_000 },
  );
  const { data: stuck, mutate: mutateStuck } = useSWR<StuckPosition[]>(
    '/api/settings/stuck-positions',
    fetcher,
    { refreshInterval: 30_000 },
  );

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [dryRunLoading, setDryRunLoading] = useState(false);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const res = await fetch('/api/settings/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });

    setSaving(false);

    if (res.ok) {
      setMsg({ type: 'ok', text: 'Perfil atualizado' });
      setProfile((p) => ({ ...p, password: '' }));
      await updateSession({ user: { walletAddress: profile.walletAddress, displayName: profile.displayName } });
    } else {
      const data = await res.json();
      setMsg({ type: 'err', text: data.error ?? 'Erro ao salvar' });
    }
  }

  async function handleResolve(posId: string) {
    await fetch('/api/settings/stuck-positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionId: posId, note: resolveNote }),
    });
    setResolvingId(null);
    setResolveNote('');
    mutateStuck();
  }

  return (
    <DashboardShell>
      <h1 className="mb-6 text-lg font-bold text-white">Settings</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GlassCard>
          <h2 className="mb-4 text-sm font-semibold text-slate-300">Perfil</h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            {msg && (
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                  msg.type === 'ok'
                    ? 'bg-success/10 text-success'
                    : 'bg-danger/10 text-danger'
                }`}
              >
                {msg.type === 'ok' ? (
                  <CheckCircle className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                {msg.text}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Display Name
              </label>
              <input
                type="text"
                value={profile.displayName}
                onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
                className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Wallet Address (Phantom)
              </label>
              <p className="mb-1.5 text-[11px] text-slate-500">
                O saldo no header vem desta wallet. Cole o endereço da sua Phantom.
              </p>
              <input
                type="text"
                value={profile.walletAddress}
                onChange={(e) => setProfile((p) => ({ ...p, walletAddress: e.target.value }))}
                className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Nova Senha (deixe vazio para manter)
              </label>
              <input
                type="password"
                value={profile.password}
                onChange={(e) => setProfile((p) => ({ ...p, password: e.target.value }))}
                className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-accent"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
          </form>
        </GlassCard>

        <GlassCard>
          <h2 className="mb-4 text-sm font-semibold text-slate-300">Bot</h2>
          {botConfig && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-200">Modo de operação</p>
                  <p className="text-xs text-slate-500">
                    {botConfig.DRY_RUN === 'true'
                      ? 'Dry Run: simulando trades (sem dinheiro real)'
                      : 'LIVE: executando trades reais'}
                  </p>
                </div>
                <button
                  disabled={dryRunLoading}
                  onClick={async () => {
                    setDryRunLoading(true);
                    const next = botConfig.DRY_RUN !== 'true';
                    const res = await fetch('/api/settings/dry-run', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ dryRun: next }),
                    });
                    if (res.ok) await mutateBotConfig();
                    setDryRunLoading(false);
                  }}
                  className={clsx(
                    'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                    botConfig.DRY_RUN === 'true'
                      ? 'bg-success/20 text-success hover:bg-success/30'
                      : 'bg-warning/20 text-warning hover:bg-warning/30',
                  )}
                >
                  {botConfig.DRY_RUN === 'true' ? (
                    <>
                      <Play className="h-4 w-4" />
                      Ativar (LIVE)
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4" />
                      Pausar (Dry Run)
                    </>
                  )}
                </button>
              </div>
              <div className="space-y-2.5 border-t border-card-border pt-4">
                {Object.entries(botConfig)
                  .filter(([k]) => k !== 'DRY_RUN')
                  .map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{key}</span>
                      <span className="font-medium text-slate-300">{val}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </GlassCard>
      </div>

      <GlassCard className="mt-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-300">Posições Stuck</h2>
        {(!stuck || stuck.length === 0) && (
          <p className="text-xs text-slate-600">Nenhuma posição stuck</p>
        )}
        <div className="space-y-3">
          {stuck?.map((sp) => (
            <div
              key={sp.positionId}
              className="flex items-start justify-between rounded-xl bg-white/[0.03] p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <span className="text-sm font-medium text-slate-200">
                    {sp.symbol || sp.tokenMint.slice(0, 8)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {sp.amountSol.toFixed(4)} SOL · Stuck at{' '}
                  {new Date(sp.stuckAt).toLocaleString('pt-BR')}
                </p>
              </div>
              <div>
                {resolvingId === sp.positionId ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder="Nota (opcional)"
                      className="w-40 rounded-lg border border-card-border bg-white/5 px-3 py-1.5 text-xs text-white outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => handleResolve(sp.positionId)}
                      className="rounded-lg bg-success/15 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/25"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setResolvingId(null)}
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setResolvingId(sp.positionId)}
                    className="rounded-lg border border-success/30 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/10"
                  >
                    Mark as Resolved
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </DashboardShell>
  );
}
