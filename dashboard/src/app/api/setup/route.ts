import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { dashboardConfig } from '@/config/dashboard.config';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const count = await prisma.user.count();
  if (count > 0) {
    return NextResponse.json({ error: 'Setup já concluído' }, { status: 403 });
  }

  const { username, password, displayName, walletAddress } = await req.json();

  if (!username || !password || !displayName || !walletAddress) {
    return NextResponse.json({ error: 'Todos os campos são obrigatórios' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'A senha deve ter pelo menos 8 caracteres' }, { status: 400 });
  }

  const hashed = await hash(password, 12);

  await prisma.user.create({
    data: {
      username,
      password: hashed,
      displayName,
      walletAddress,
      tier: 'admin',
    },
  });

  return NextResponse.json({ success: true });
}

export async function GET() {
  const count = await prisma.user.count();
  return NextResponse.json({
    setupRequired: count === 0,
    maxUsers: dashboardConfig.auth.maxUsers,
    currentUsers: count,
  });
}
