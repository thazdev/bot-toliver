import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { dashboardConfig } from '@/config/dashboard.config';
import type { BotHealth } from '@/types';

async function getDryRun(): Promise<boolean> {
  try {
    const val = await redis.get('bot:dry_run');
    if (val !== null && val !== undefined) return val === 'true';
  } catch {}
  return dashboardConfig.bot.dryRun;
}

export async function GET() {
  try {
    await redis.connect().catch(() => {});

    const [healthRaw, dryRun] = await Promise.all([
      redis.get('bot_health'),
      getDryRun(),
    ]);

    if (healthRaw) {
      const health = JSON.parse(healthRaw);
      const status = health.status ?? (dryRun ? 'DRY_RUN' : 'RUNNING');
      return NextResponse.json({
        status,
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
    const inferredStatus = statRecent ? (dryRun ? 'DRY_RUN' : 'RUNNING') : 'UNKNOWN';

    return NextResponse.json({
      status: inferredStatus,
      lastHeartbeat: latestStat?.snapshotAt?.toISOString() ?? null,
      uptimeSeconds: latestStat ? Number(latestStat.uptimeSeconds) : 0,
    } satisfies BotHealth);
  } catch {
    return NextResponse.json({
      status: 'UNKNOWN',
      lastHeartbeat: null,
      uptimeSeconds: 0,
    } satisfies BotHealth);
  }
}
