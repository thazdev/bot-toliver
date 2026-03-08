import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireAuth } from '@/lib/auth-guard';

const STAGE2_REASON_KEYS = [
  'liquidity_too_low',
  'mint_authority_active',
  'freeze_authority_set',
  'rug_score_too_low',
  'fetch_failed',
  'outros',
] as const;

const STAGE1_REASON_KEYS = [
  'blacklist',
  'honeypot_db',
  'known_rug_dev',
  'token_too_new',
  'token_blacklisted',
  'emergency_halt',
  'outros',
  'unknown',
] as const;

export interface DiagnosticsResponse {
  pipeline: {
    tokens_received: number;
    stage1: { total: number; reasons: Record<string, number> };
    stage2: { total: number; reasons: Record<string, number>; passed: number };
    stage3_entries: number;
    stage4: number;
    stage5: number;
    stage6: number;
    passed: number;
  };
  last_passed_tokens: Array<{
    mint: string;
    entryScore: number;
    liquidity: number;
    holders: number;
    hasBuySignal: boolean;
    skipReasons: string[];
    tradeExecuted: boolean;
    timestamp: string;
  }>;
  bot_health: Record<string, unknown> | null;
  lastUpdated: string;
}

export async function GET() {
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    const { error } = await requireAuth();
    if (error) return error;
  }

  try {
    await redis.connect();
  } catch (e) {
    return NextResponse.json(
      { error: 'Redis connect failed', detail: String(e) },
      { status: 503 }
    );
  }

  const pipeline: DiagnosticsResponse['pipeline'] = {
    tokens_received: 0,
    stage1: { total: 0, reasons: {} },
    stage2: { total: 0, reasons: {}, passed: 0 },
    stage3_entries: 0,
    stage4: 0,
    stage5: 0,
    stage6: 0,
    passed: 0,
  };

  const get = (key: string): Promise<string | null> =>
    redis.get(key).catch(() => null);

  const getInt = async (key: string): Promise<number> => {
    const v = await get(key);
    return parseInt(v ?? '0', 10);
  };

  pipeline.tokens_received = await getInt('diag:tokens_received_total');
  pipeline.stage1.total = await getInt('diag:tokens_stage1_rejected');
  for (const k of STAGE1_REASON_KEYS) {
    pipeline.stage1.reasons[k] = await getInt(`diag:stage1_reject_${k}`);
  }
  pipeline.stage2.total = await getInt('diag:tokens_stage2_rejected');
  for (const k of STAGE2_REASON_KEYS) {
    pipeline.stage2.reasons[k] = await getInt(`diag:stage2_reject_${k}`);
  }
  pipeline.stage2.passed = await getInt('diag:stage2_passed');
  pipeline.stage3_entries = await getInt('diag:stage3_entries');
  pipeline.stage4 = await getInt('diag:tokens_stage4_rejected');
  pipeline.stage5 = await getInt('diag:tokens_stage5_rejected');
  pipeline.stage6 = await getInt('diag:tokens_stage6_rejected');
  pipeline.passed = await getInt('diag:tokens_passed');

  const rawList = await redis.lrange('diag:passed_tokens_log', 0, 49);
  const last_passed_tokens = rawList.map((s) => {
    try {
      const o = JSON.parse(s) as {
        mint: string;
        entryScore: number;
        liquidity: number;
        holders: number;
        hasBuySignal: boolean;
        skipReasons: string[];
        tradeExecuted: boolean;
        timestamp: string;
      };
      return {
        mint: o.mint ?? '',
        entryScore: o.entryScore ?? 0,
        liquidity: o.liquidity ?? 0,
        holders: o.holders ?? 0,
        hasBuySignal: o.hasBuySignal ?? false,
        skipReasons: Array.isArray(o.skipReasons) ? o.skipReasons : [],
        tradeExecuted: o.tradeExecuted ?? false,
        timestamp: o.timestamp ?? new Date().toISOString(),
      };
    } catch {
      return {
        mint: '',
        entryScore: 0,
        liquidity: 0,
        holders: 0,
        hasBuySignal: false,
        skipReasons: [] as string[],
        tradeExecuted: false,
        timestamp: new Date().toISOString(),
      };
    }
  });

  let bot_health: Record<string, unknown> | null = null;
  const bhRaw = await get('bot_health');
  if (bhRaw) {
    try {
      bot_health = JSON.parse(bhRaw) as Record<string, unknown>;
    } catch {
      bot_health = { raw: bhRaw };
    }
  }

  const response: DiagnosticsResponse = {
    pipeline,
    last_passed_tokens,
    bot_health,
    lastUpdated: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
