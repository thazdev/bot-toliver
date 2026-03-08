import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import type { BotHealth } from '@/types';

async function getBotMode(): Promise<'dry-run' | 'real'> {
  try {
    const val = await redis.get('bot:mode');
    if (val === 'real') return 'real';
  } catch {}
  return 'dry-run';
}

export async function GET() {
  try {
    await redis.connect().catch(() => {});

    const [healthRaw, mode, enabledRaw, lifecycleState] = await Promise.all([
      redis.get('bot_health').catch(() => null),
      getBotMode(),
      redis.get('bot:enabled').catch(() => null),
      redis.get('bot:lifecycle_state').catch(() => null),
    ]);

    const enabled = enabledRaw !== 'false';

    type BotStatus = BotHealth['status'];

    function resolveStatus(): BotStatus {
      if (!enabled) return 'PAUSED';
      if (lifecycleState === 'RUNNING' || lifecycleState === 'STARTING') {
        return mode === 'dry-run' ? 'DRY_RUN' : 'RUNNING';
      }
      return 'UNKNOWN';
    }

    if (healthRaw) {
      const health = JSON.parse(healthRaw);
      const fromHealth = health.status as BotStatus | undefined;
      const status: BotStatus = resolveStatus() !== 'UNKNOWN' ? resolveStatus() : (fromHealth ?? 'UNKNOWN');

      return NextResponse.json({
        status,
        mode,
        lastHeartbeat: health.lastHeartbeat ?? health.timestamp ?? null,
        uptimeSeconds: health.uptimeSeconds ?? 0,
      } satisfies BotHealth);
    }

    const quickStatus = resolveStatus();
    if (quickStatus !== 'UNKNOWN') {
      return NextResponse.json({
        status: quickStatus,
        mode,
        lastHeartbeat: null,
        uptimeSeconds: 0,
      } satisfies BotHealth);
    }

    {
      const latestStat = await (async () => {
        try {
          const { prisma } = await import('@/lib/prisma');
          return await prisma.stat.findFirst({ orderBy: { snapshotAt: 'desc' } });
        } catch {
          return null;
        }
      })();

      const statRecent = latestStat?.snapshotAt
        ? (Date.now() - new Date(latestStat.snapshotAt).getTime()) < 30 * 60 * 1000
        : false;
      const status: BotStatus = statRecent ? (mode === 'dry-run' ? 'DRY_RUN' : 'RUNNING') : 'UNKNOWN';

      return NextResponse.json({
        status,
        mode,
        lastHeartbeat: latestStat?.snapshotAt?.toISOString() ?? null,
        uptimeSeconds: latestStat ? Number(latestStat.uptimeSeconds) : 0,
      } satisfies BotHealth);
    }
  } catch {
    return NextResponse.json({
      status: 'UNKNOWN',
      mode: 'dry-run',
      lastHeartbeat: null,
      uptimeSeconds: 0,
    } satisfies BotHealth);
  }
}
