'use client';

import { GlassCard } from '@/components/ui/GlassCard';
import { GlowNumber } from '@/components/ui/GlowNumber';
import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  icon: LucideIcon;
  neutral?: boolean;
}

export function KpiCard({
  title,
  value,
  prefix,
  suffix,
  decimals = 2,
  icon: Icon,
  neutral = false,
}: KpiCardProps) {
  return (
    <GlassCard className="flex items-start justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
        <div className="mt-2 text-2xl font-bold">
          <GlowNumber
            value={value}
            prefix={prefix}
            suffix={suffix}
            decimals={decimals}
            neutral={neutral}
          />
        </div>
      </div>
      <div className="rounded-xl bg-accent/10 p-2.5">
        <Icon className="h-5 w-5 text-accent" />
      </div>
    </GlassCard>
  );
}
