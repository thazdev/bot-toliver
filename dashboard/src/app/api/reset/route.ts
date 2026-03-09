import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reset
 * Limpa todas as posições dry-run (abertas + fechadas), trades do Redis,
 * e contadores de diagnóstico. Permite começar do zero.
 */
export async function POST() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    // 1. Fechar/remover todas as posições dry-run abertas
    const openIds = await redis.smembers('dry_positions:open');
    if (openIds.length > 0) {
      const positionKeys = openIds.map((id: string) => `dry_position:${id}`);
      await redis.del(...positionKeys);
    }
    await redis.del('dry_positions:open');

    // 2. Limpar histórico de posições fechadas
    await redis.del('dry_positions:closed');

    // 3. Limpar log de tokens passados (diagnóstico)
    await redis.del('diag:passed_tokens_log');

    // 4. Resetar contadores de diagnóstico do pipeline
    const diagKeys = await redis.keys('diag:*');
    if (diagKeys.length > 0) {
      await redis.del(...diagKeys);
    }

    // 5. Limpar locks de compra pendentes
    const buyLockKeys = await redis.keys('buy_lock:*');
    if (buyLockKeys.length > 0) {
      await redis.del(...buyLockKeys);
    }

    // 6. Limpar cache de preços (para forçar refresh)
    const priceKeys = await redis.keys('price_sol:*');
    if (priceKeys.length > 0) {
      await redis.del(...priceKeys);
    }

    const totalCleaned = openIds.length + diagKeys.length + buyLockKeys.length + priceKeys.length;

    return NextResponse.json({
      success: true,
      message: 'Reset completo — todas as posições e dados de diagnóstico foram limpos.',
      details: {
        openPositionsCleared: openIds.length,
        diagKeysCleared: diagKeys.length,
        buyLocksCleared: buyLockKeys.length,
        priceCacheCleared: priceKeys.length,
        closedListCleared: true,
        totalKeysRemoved: totalCleaned,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Falha no reset: ${msg}` },
      { status: 500 },
    );
  }
}
