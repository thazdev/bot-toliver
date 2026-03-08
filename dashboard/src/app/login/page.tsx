'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Bot, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await signIn('credentials', {
      username,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError('Credenciais inválidas');
    } else {
      window.location.href = '/';
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15">
            <Bot className="h-7 w-7 text-accent" />
          </div>
          <h1 className="text-xl font-bold text-white">Toliver Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Entre com suas credenciais</p>
        <Link href="/signup" className="mt-2 text-xs text-accent hover:underline">
          Não tem conta? Criar conta
        </Link>
        </div>

        <form onSubmit={handleSubmit} className="glass-card space-y-4 p-6">
          {error && (
            <div className="rounded-lg bg-danger/10 px-4 py-2 text-xs text-danger">{error}</div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-accent"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-xl border border-card-border bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-accent"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
