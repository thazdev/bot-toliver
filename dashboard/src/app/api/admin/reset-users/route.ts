import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const secret = process.env.RESET_USERS_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Reset não configurado' }, { status: 501 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.secret !== secret) {
    return NextResponse.json({ error: 'Secret inválido' }, { status: 403 });
  }

  await prisma.user.deleteMany({});
  return NextResponse.json({ success: true, message: 'Todos os usuários foram removidos' });
}
