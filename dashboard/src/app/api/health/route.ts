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

    const [healthRaw, mode] = await Promise.all([
      redis.get('bot_health'),
      getBotMode(),
    ]);

    if (healthRaw) {
      const health = JSON.parse(healthRaw);
      const status = health.status ?? (mode === 'dry-run' ? 'DRY_RUN' : 'RUNNING');
      return NextResponse.json({
        status,
        mode,
        lastHeartbeat: health.lastHeartbeat ?? health.timestamp ?? null,
        uptimeSeconds: health.uptimeSeconds ?? 0,
      } satisfies BotHealth);
    }

    const latestStat = await (async () => {
      try {
        const { prisma } = await import('@/lib/prisma');
        return await prisma.stat.findFirst({ orderBy: { snapshotAt: 'desc' } });
      } catch {
        return null;
      }
    })();

    const statRecent = latestStat && latestStat.snapshotAt
      ? (Date.now() - new Date(latestStat.snapshotAt).getTime()) < 30 * 60 * 1000
      : false;
    const inferredStatus = statRecent ? (mode === 'dry-run' ? 'DRY_RUN' : 'RUNNING') : 'UNKNOWN';

    return NextResponse.json({
      status: inferredStatus,
      mode,
      lastHeartbeat: latestStat?.snapshotAt?.toISOString() ?? null,
      uptimeSeconds: latestStat ? Number(latestStat.uptimeSeconds) : 0,
    } satisfies BotHealth);
  } catch {
    return NextResponse.json({
      status: 'UNKNOWN',
      mode: 'dry-run',
      lastHeartbeat: null,
      uptimeSeconds: 0,
    } satisfies BotHealth);
  }
}
