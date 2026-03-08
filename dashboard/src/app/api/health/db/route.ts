import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, string> = {};

  checks.DATABASE_URL = process.env.DATABASE_URL
    ? `${process.env.DATABASE_URL.slice(0, 30)}...`
    : 'NOT SET';

  checks.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ? 'SET' : 'NOT SET';
  checks.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'NOT SET';

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, checks });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: err, checks }, { status: 503 });
  }
}
