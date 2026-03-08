'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bot, Loader2, Wallet, CheckCircle } from 'lucide-react';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    walletAddress: '',
    username: '',
    password: '',
    confirmPassword: '',
    displayName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [canSignup, setCanSignup] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    fetch('/api/signup')
      .then((r) => {
        if (!r.ok) throw new Error('API error');
        return r.json();
      })
      .then((d) => {
        setCanSignup(d.canSignup ?? false);
        setLoadError('');
      })
      .catch(() => {
        setCanSignup(null);
        setLoadError('Erro ao conectar. Verifique se o banco de dados está configurado.');
      });
  }, []);

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

    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username,
        password: form.password,
        displayName: form.displayName,
        walletAddress: form.walletAddress.trim(),
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Erro ao criar conta');
      return;
    }

    setDone(true);
    setTimeout(() => router.push('/login'), 2000);
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="glass-card max-w-sm p-6 text-center">
          <p className="text-danger">{loadError}</p>
          <p className="mt-2 text-xs text-slate-500">
            No Railway: confira se DATABASE_URL está correto nas Variables do dashboard.
          </p>
          <Link href="/login" className="mt-4 inline-block text-accent hover:underline">
            Ir para login
          </Link>
        </div>
      </div>
    );
  }

  if (canSignup === false) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="glass-card max-w-sm p-6 text-center">
          <p className="text-slate-300">Máximo de usuários atingido.</p>
          <Link href="/login" className="mt-4 inline-block text-accent hover:underline">
            Ir para login
          </Link>
        </div>
      </div>
    );
  }

  if (canSignup === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-400">Carregando…</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <CheckCircle className="h-12 w-12 text-success" />
          <p className="text-lg font-semibold text-white">Conta criada com sucesso!</p>
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
          <h1 className="text-xl font-bold text-white">Criar conta</h1>
          <p className="mt-1 text-sm text-slate-500">Vincule sua wallet Solana</p>
        </div>

        <form onSubmit={handleSubmit} className="glass-card space-y-4 p-6">
          {error && (
            <div className="rounded-lg bg-danger/10 px-4 py-2 text-xs text-danger">{error}</div>
          )}

          <div>
            <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-400">
              <Wallet className="h-3.5 w-3.5" />
              Wallet Address (Solana)
            </label>
            <input
              type="text"
              value={form.walletAddress}
              onChange={(e) => update('walletAddress', e.target.value)}
              required
              placeholder="Ex: 3X4xx3oY1kwfNeSnGLfn9ANmyxHzmcR7dKQ..."
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Display Name</label>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => update('displayName', e.target.value)}
              required
              placeholder="Seu nome"
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Username</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => update('username', e.target.value)}
              required
              placeholder="Para login"
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              required
              placeholder="Mínimo 8 caracteres"
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
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
              placeholder="Repita a senha"
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar conta
          </button>

          <p className="text-center text-xs text-slate-500">
            Já tem conta?{' '}
            <Link href="/login" className="text-accent hover:underline">
              Entrar
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
