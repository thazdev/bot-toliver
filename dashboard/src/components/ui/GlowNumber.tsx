'use client';

import { clsx } from 'clsx';

interface GlowNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
  neutral?: boolean;
}

export function GlowNumber({
  value,
  prefix = '',
  suffix = '',
  decimals = 2,
  className,
  neutral = false,
}: GlowNumberProps) {
  const isPositive = value >= 0;
  const formatted = `${prefix}${Math.abs(value).toFixed(decimals)}${suffix}`;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';

  return (
    <span
      className={clsx(
        'font-semibold tabular-nums',
        !neutral && isPositive && 'glow-green',
        !neutral && !isPositive && 'glow-red',
        neutral && 'text-slate-200',
        className,
      )}
    >
      {sign}{formatted}
    </span>
  );
}
