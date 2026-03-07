import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth-guard';

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { displayName, walletAddress, password } = await req.json();
  const userId = Number(session!.user.id);

  const updateData: Record<string, string> = {};

  if (displayName) updateData.displayName = displayName;
  if (walletAddress) updateData.walletAddress = walletAddress;
  if (password) {
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'A senha deve ter pelo menos 8 caracteres' },
        { status: 400 },
      );
    }
    updateData.password = await hash(password, 12);
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 });
  }

  await prisma.user.update({ where: { id: userId }, data: updateData });

  return NextResponse.json({ success: true });
}
