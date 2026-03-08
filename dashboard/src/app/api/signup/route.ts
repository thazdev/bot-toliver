import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { dashboardConfig } from '@/config/dashboard.config';

async function ensureUsersTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      username       VARCHAR(64)  NOT NULL UNIQUE,
      password       VARCHAR(255) NOT NULL,
      display_name   VARCHAR(128) NOT NULL,
      wallet_address VARCHAR(128) NOT NULL,
      tier           VARCHAR(32)  NOT NULL DEFAULT 'admin',
      created_at     DATETIME     NOT NULL DEFAULT NOW()
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureWalletColumnSize() {
  await prisma.$executeRawUnsafe(`ALTER TABLE users MODIFY wallet_address VARCHAR(128) NOT NULL`).catch(() => {});
}

export async function POST(req: NextRequest) {
  try {
    try {
      await prisma.user.count();
    } catch {
      await ensureUsersTable();
    }
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

    await ensureWalletColumnSize();

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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[signup POST]', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
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
    try {
      await ensureUsersTable();
      const count = await prisma.user.count();
      return NextResponse.json({
        canSignup: count < dashboardConfig.auth.maxUsers,
        maxUsers: dashboardConfig.auth.maxUsers,
        currentUsers: count,
      });
    } catch (e2) {
      console.error('[signup GET]', e2);
      return NextResponse.json(
        { canSignup: false, error: 'Database connection failed' },
        { status: 503 },
      );
    }
  }
}
