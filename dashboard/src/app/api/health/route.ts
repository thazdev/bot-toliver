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
      const status = dryRun ? 'DRY_RUN' : health.status ?? 'RUNNING';
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

    return NextResponse.json({
      status: dryRun ? 'DRY_RUN' : 'UNKNOWN',
      lastHeartbeat: null,
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
