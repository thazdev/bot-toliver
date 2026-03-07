'use client';

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ZAxis,
} from 'recharts';
import { GlassCard } from '@/components/ui/GlassCard';

interface Props {
  data: { score: string; roi: number }[];
}

export function ScoreVsRoiChart({ data }: Props) {
  return (
    <GlassCard>
      <h3 className="mb-4 text-sm font-semibold text-slate-300">Entry Score vs ROI</h3>
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
          <XAxis
            dataKey="score"
            name="Score"
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            dataKey="roi"
            name="ROI"
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          />
          <ZAxis range={[40, 40]} />
          <Tooltip
            contentStyle={{
              background: 'rgba(15,15,25,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(val: number, name: string) =>
              name === 'ROI' ? [`${val.toFixed(2)}%`, name] : [val, name]
            }
          />
          <Scatter
            data={data}
            fill="#6366f1"
            fillOpacity={0.7}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </GlassCard>
  );
}
