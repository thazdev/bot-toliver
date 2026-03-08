import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { dashboardConfig } from '@/config/dashboard.config';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

/**
 * Debug: mostra qual wallet está sendo usada e o saldo bruto.
 * Acesse /api/wallet/info (logado) para verificar.
 */
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  let walletAddress = session!.user.walletAddress || dashboardConfig.bot.walletAddress;

  if (!walletAddress && session!.user.id) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: parseInt(session!.user.id, 10) },
        select: { walletAddress: true },
      });
      walletAddress = user?.walletAddress || '';
    } catch {}
  }

  const isLikelyPrivateKey = walletAddress && walletAddress.length > 50;

  if (!walletAddress) {
    return NextResponse.json({
      error: 'Nenhuma wallet configurada',
      hint: 'Vá em Settings e adicione o endereço público da sua Phantom (Receber > Copiar)',
    });
  }

  if (isLikelyPrivateKey) {
    return NextResponse.json({
      error: 'Wallet inválida',
      hint: 'O valor parece ser uma chave PRIVADA. Use o endereço PÚBLICO (Phantom > Receber > Copiar). Tem 43-44 caracteres.',
      walletLength: walletAddress.length,
    });
  }

  const heliusUrl = dashboardConfig.rpc.heliusUrl;
  if (!heliusUrl) {
    return NextResponse.json({ error: 'HELIUS_RPC_URL não configurada' });
  }

  try {
    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [walletAddress.trim()],
      }),
    });

    const json = await res.json();
    const lamports = json.result?.value ?? 0;
    const sol = lamports / 1e9;

    return NextResponse.json({
      walletSuffix: `...${walletAddress.slice(-8)}`,
      walletLength: walletAddress.length,
      lamports,
      sol,
      rpcError: json.error ?? null,
      source: session!.user.walletAddress ? 'perfil' : 'BOT_WALLET_ADDRESS',
    });
  } catch (e) {
    return NextResponse.json({
      error: 'Falha ao consultar RPC',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
