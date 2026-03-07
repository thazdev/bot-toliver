import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { requireAuth } from '@/lib/auth-guard';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requireAuth();
  if (error) return error;

  const position = await prisma.position.findUnique({ where: { id: params.id } });
  if (!position || position.status !== 'open') {
    return NextResponse.json({ error: 'Position not found or not open' }, { status: 404 });
  }

  await redis.publish(
    'dashboard:force-exit',
    JSON.stringify({
      positionId: params.id,
      tokenMint: position.tokenMint,
      type: 'EMERGENCY',
      timestamp: new Date().toISOString(),
    }),
  );

  return NextResponse.json({ success: true, positionId: params.id });
}
