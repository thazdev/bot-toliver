import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { dashboardConfig } from '@/config/dashboard.config';

export async function POST(req: NextRequest) {
  const count = await prisma.user.count();
  if (count >= dashboardConfig.auth.maxUsers) {
    return NextResponse.json(
      { error: `Máximo de ${dashboardConfig.auth.maxUsers} usuários atingido` },
      { status: 403 },
    );
  }

  const { username, password, displayName, walletAddress } = await req.json();

  if (!username || !password || !displayName || !walletAddress) {
    return NextResponse.json({ error: 'Todos os campos são obrigatórios' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'A senha deve ter pelo menos 8 caracteres' }, { status: 400 });
  }

  const wallet = String(walletAddress).trim();
  if (wallet.length < 32) {
    return NextResponse.json({ error: 'Wallet address inválida' }, { status: 400 });
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ username }, { walletAddress: wallet }],
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: existing.username === username ? 'Username já existe' : 'Essa wallet já está cadastrada' },
      { status: 400 },
    );
  }

  const hashed = await hash(password, 12);

  await prisma.user.create({
    data: {
      username,
      password: hashed,
      displayName,
      walletAddress: wallet,
      tier: count === 0 ? 'admin' : 'user',
    },
  });

  return NextResponse.json({ success: true });
}

export async function GET() {
  try {
    const count = await prisma.user.count();
    return NextResponse.json({
      canSignup: count < dashboardConfig.auth.maxUsers,
      maxUsers: dashboardConfig.auth.maxUsers,
      currentUsers: count,
    });
  } catch (e) {
    console.error('[signup GET]', e);
    return NextResponse.json(
      { canSignup: false, error: 'Database connection failed' },
      { status: 503 },
    );
  }
}
