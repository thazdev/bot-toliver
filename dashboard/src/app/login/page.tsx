'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Bot, Loader2, Bug } from 'lucide-react';
import { debugLog, getDebugLogs, clearDebugLogs, type LogEntry } from '@/lib/debug-log';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [debugLogs, setDebugLogs] = useState<LogEntry[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    debugLog('0-LOGIN-PAGE-MOUNTED', { path: window.location.pathname, search: window.location.search });
    setDebugLogs(getDebugLogs());
    const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug=1');
    setShowDebug(isDebug || getDebugLogs().length > 0);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    debugLog('1-LOGIN-SUBMIT', { username });

    try {
      // redirect: true = servidor retorna 302 com Set-Cookie na mesma resposta.
      // Evita problema de cookie não ser enviado em navegação posterior (Railway/proxy).
      const res = await signIn('credentials', {
        username,
        password,
        redirect: true,
        callbackUrl: '/',
      }) as { ok?: boolean; error?: string; status?: number; url?: string } | undefined;

      debugLog('2-SIGNIN-RESPONSE', {
        ok: res?.ok,
        error: res?.error,
        status: res?.status,
        url: res?.url,
      });

      setLoading(false);

      // Com redirect: true, signIn não retorna em caso de sucesso (navega).
      if (res?.error) {
        debugLog('3-SIGNIN-ERROR', res.error);
        setError('Credenciais inválidas');
      }
    } catch (err) {
      debugLog('6-SIGNIN-EXCEPTION', { err: String(err) });
      setLoading(false);
      setError('Erro ao fazer login');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="fixed right-4 top-4 flex gap-2">
        <button
          type="button"
          onClick={() => setShowDebug((d) => !d)}
          className="flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-400"
        >
          <Bug className="h-3 w-3" />
          Debug {debugLogs.length}
        </button>
        {showDebug && (
          <button
            type="button"
            onClick={() => {
              clearDebugLogs();
              setDebugLogs([]);
            }}
            className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-500"
          >
            Limpar
          </button>
        )}
      </div>
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

        {showDebug && debugLogs.length > 0 && (
          <div className="mt-6 max-h-64 overflow-auto rounded-xl border border-slate-700 bg-slate-900/90 p-3 font-mono text-xs">
            <p className="mb-2 text-slate-500">Logs (persistem após refresh):</p>
            {debugLogs.map((log, i) => (
              <div key={i} className="mb-1 border-b border-slate-800 pb-1 last:border-0">
                <span className="text-slate-500">{log.ts.split('T')[1]?.slice(0, 12)}</span>{' '}
                <span className="text-accent">{log.step}</span>
                {log.data !== undefined && (
                  <pre className="mt-0.5 overflow-x-auto text-slate-400">
                    {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
