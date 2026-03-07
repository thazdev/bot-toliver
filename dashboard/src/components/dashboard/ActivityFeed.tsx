'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ShieldAlert,
  OctagonX,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useSocket } from '@/hooks/useSocket';
import type { ActivityEvent } from '@/types';

const iconMap: Record<ActivityEvent['type'], React.ElementType> = {
  buy: ArrowDownCircle,
  sell: ArrowUpCircle,
  stop_loss: ShieldAlert,
  rug_rejected: OctagonX,
  stuck: AlertTriangle,
  alert: Info,
};

const colorMap: Record<ActivityEvent['type'], string> = {
  buy: 'text-accent',
  sell: 'text-success',
  stop_loss: 'text-danger',
  rug_rejected: 'text-warning',
  stuck: 'text-warning',
  alert: 'text-slate-400',
};

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;

    const handler = (event: ActivityEvent) => {
      setEvents((prev) => [event, ...prev].slice(0, 50));
    };

    socket.on('trade_executed', handler);
    socket.on('alert', handler);
    socket.on('bot_status', handler);

    return () => {
      socket.off('trade_executed', handler);
      socket.off('alert', handler);
      socket.off('bot_status', handler);
    };
  }, [socket]);

  return (
    <GlassCard className="flex flex-col">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Atividade em Tempo Real</h3>
      <div className="flex-1 space-y-1 overflow-y-auto" style={{ maxHeight: 320 }}>
        {events.length === 0 && (
          <p className="py-8 text-center text-xs text-slate-600">Aguardando eventos…</p>
        )}
        {events.map((ev) => {
          const Icon = iconMap[ev.type] ?? Info;
          return (
            <div
              key={ev.id}
              className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
            >
              <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', colorMap[ev.type])} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-300">{ev.message}</p>
                <p className="text-[10px] text-slate-600">
                  {new Date(ev.timestamp).toLocaleTimeString('pt-BR')}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
