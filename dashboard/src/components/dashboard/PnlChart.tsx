'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { GlassCard } from '@/components/ui/GlassCard';
import { fetcher } from '@/lib/fetcher';
import type { PnlPoint } from '@/types';

export function PnlChart() {
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const { data } = useSWR<PnlPoint[]>(`/api/dashboard/pnl-chart?range=${range}`, fetcher, {
    refreshInterval: 30_000,
  });

  const points = data ?? [];
  const lastPnl = points.at(-1)?.cumulativePnl ?? 0;
  const color = lastPnl >= 0 ? '#10b981' : '#ef4444';

  return (
    <GlassCard className="col-span-full">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">P&L Acumulado</h3>
        <div className="flex gap-1 rounded-lg bg-white/5 p-0.5">
          {(['24h', '7d'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                range === r ? 'bg-accent text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={points}>
          <defs>
            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: string) => {
              const d = new Date(v);
              return range === '24h'
                ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            }}
          />
          <YAxis
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(3)}`}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(15,15,25,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              fontSize: 12,
            }}
            labelFormatter={(v: string) => new Date(v).toLocaleString('pt-BR')}
            formatter={(val: number) => [`${val.toFixed(4)} SOL`, 'P&L']}
          />
          <Area
            type="monotone"
            dataKey="cumulativePnl"
            stroke={color}
            strokeWidth={2}
            fill="url(#pnlGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </GlassCard>
  );
}
