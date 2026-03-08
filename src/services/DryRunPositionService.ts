import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';

export interface DryRunPosition {
  id: string;
  tokenMint: string;
  entryPrice: number;
  entryTime: string;
  amountSOL: number;
  amountTokens: number;
  entryScore: number;
  strategy: string;
  tier: string;
  stopLossPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  trailingStopPrice: number | null;
  peakPrice: number;
  currentPrice: number;
  currentPnlPct: number;
  currentPnlSOL: number;
  status: 'open' | 'closed';
  exitPrice?: number;
  exitReason?: string;
  exitTime?: string;
  finalPnlPct?: number;
  finalPnlSOL?: number;
}

const POSITION_TTL_SEC = 7200;
const OPEN_SET_KEY = 'dry_positions:open';
const CLOSED_LIST_KEY = 'dry_positions:closed';
const CLOSED_LIST_MAX = 100;

function getRedis() {
  return RedisClient.getInstance().getClient();
}

/**
 * Retorna a soma de amountSOL de todas as posições dry run abertas.
 * Usado para cálculo de capital disponível.
 */
export async function getOpenPositionsTotalSOL(): Promise<number> {
  try {
    const redis = getRedis();
    const openIds = await redis.smembers(OPEN_SET_KEY);
    if (openIds.length === 0) return 0;

    let total = 0;
    for (const id of openIds) {
      const raw = await redis.get(`dry_position:${id}`);
      if (raw) {
        try {
          const pos = JSON.parse(raw) as DryRunPosition;
          if (pos.status === 'open' && typeof pos.amountSOL === 'number') {
            total += pos.amountSOL;
          }
        } catch {
          // Skip invalid
        }
      }
    }
    return total;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('DryRunPositionService: getOpenPositionsTotalSOL failed', { error: msg });
    return 0;
  }
}

/**
 * Salva posição dry run no Redis.
 */
export async function saveDryRunPosition(position: DryRunPosition): Promise<void> {
  const redis = getRedis();
  await redis.set(`dry_position:${position.id}`, JSON.stringify(position), 'EX', POSITION_TTL_SEC);
  await redis.sadd(OPEN_SET_KEY, position.id);
}

/**
 * Lista IDs de posições abertas.
 */
export async function getOpenPositionIds(): Promise<string[]> {
  const redis = getRedis();
  return redis.smembers(OPEN_SET_KEY);
}

/**
 * Obtém posição por ID.
 */
export async function getPosition(id: string): Promise<DryRunPosition | null> {
  const redis = getRedis();
  const raw = await redis.get(`dry_position:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DryRunPosition;
  } catch {
    return null;
  }
}

/**
 * Atualiza posição no Redis.
 */
export async function updatePosition(position: DryRunPosition): Promise<void> {
  const redis = getRedis();
  await redis.set(`dry_position:${position.id}`, JSON.stringify(position), 'EX', POSITION_TTL_SEC);
}

/**
 * Fecha posição: remove do set open, adiciona ao histórico closed.
 */
export async function closePosition(position: DryRunPosition): Promise<void> {
  const redis = getRedis();
  await redis.srem(OPEN_SET_KEY, position.id);
  await redis.lpush(CLOSED_LIST_KEY, JSON.stringify(position));
  await redis.ltrim(CLOSED_LIST_KEY, 0, CLOSED_LIST_MAX - 1);
}

/**
 * Lista posições abertas (para API).
 */
export async function listOpenPositions(): Promise<DryRunPosition[]> {
  const ids = await getOpenPositionIds();
  const positions: DryRunPosition[] = [];
  for (const id of ids) {
    const pos = await getPosition(id);
    if (pos && pos.status === 'open') positions.push(pos);
  }
  return positions;
}

/**
 * Lista posições fechadas (últimas N).
 */
export async function listClosedPositions(limit = 100): Promise<DryRunPosition[]> {
  const redis = getRedis();
  const rawList = await redis.lrange(CLOSED_LIST_KEY, 0, limit - 1);
  const positions: DryRunPosition[] = [];
  for (const raw of rawList) {
    try {
      positions.push(JSON.parse(raw) as DryRunPosition);
    } catch {
      // Skip invalid
    }
  }
  return positions;
}
