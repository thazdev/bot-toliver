'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Loader2, CheckCircle } from 'lucide-react';

export default function SetupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    displayName: '',
    walletAddress: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (form.password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres');
      return;
    }

    setLoading(true);

    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username,
        password: form.password,
        displayName: form.displayName,
        walletAddress: form.walletAddress,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Erro ao criar usuário');
      return;
    }

    setDone(true);
    setTimeout(() => router.push('/login'), 2000);
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <CheckCircle className="h-12 w-12 text-success" />
          <p className="text-lg font-semibold text-white">Admin criado com sucesso!</p>
          <p className="text-sm text-slate-400">Redirecionando para login…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15">
            <Bot className="h-7 w-7 text-accent" />
          </div>
          <h1 className="text-xl font-bold text-white">Setup Inicial</h1>
          <p className="mt-1 text-sm text-slate-500">Crie o primeiro administrador</p>
        </div>

        <form onSubmit={handleSubmit} className="glass-card space-y-4 p-6">
          {error && (
            <div className="rounded-lg bg-danger/10 px-4 py-2 text-xs text-danger">{error}</div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Username</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => update('username', e.target.value)}
              required
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
              placeholder="admin"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Display Name</label>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => update('displayName', e.target.value)}
              required
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
              placeholder="Seu nome"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Wallet Address</label>
            <input
              type="text"
              value={form.walletAddress}
              onChange={(e) => update('walletAddress', e.target.value)}
              required
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
              placeholder="Solana wallet address"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              required
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">
              Confirmar Password
            </label>
            <input
              type="password"
              value={form.confirmPassword}
              onChange={(e) => update('confirmPassword', e.target.value)}
              required
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
              placeholder="Repita a senha"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar Admin
          </button>
        </form>
      </div>
    </div>
  );
}
