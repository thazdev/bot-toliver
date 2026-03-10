import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

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
    pre_pipeline: {
      logs_no_token: number;
      listener_liquidity_below: number;
      scanner_skip_cache: number;
      scanner_skip_no_mint: number;
      scanner_skip_account_not_found: number;
      scanner_skip_error: number;
      pool_not_found: number;
      swap_gate_deferred: number;
      swap_gate_dropped: number;
      institutional_filtered: number;
    };
    signal_stack: {
      evaluated: number;
      passed: number;
      failed: number;
      fail_reasons: Record<string, number>;
    };
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
    tradeBlockReason?: string;
    timestamp: string;
  }>;
  bot_health: Record<string, unknown> | null;
  lastUpdated: string;
  /** Quando Redis está indisponível */
  redisError?: string;
}

export async function GET() {
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    const { error } = await requireAuth();
    if (error) return error;
  }

  try {
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      await redis.connect();
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (!errMsg.includes('already connecting') && !errMsg.includes('already connected')) {
      return NextResponse.json({
        pipeline: {
          tokens_received: 0,
          pre_pipeline: {
            logs_no_token: 0, listener_liquidity_below: 0,
            scanner_skip_cache: 0, scanner_skip_no_mint: 0,
            scanner_skip_account_not_found: 0, scanner_skip_error: 0,
            pool_not_found: 0, swap_gate_deferred: 0, swap_gate_dropped: 0,
            institutional_filtered: 0,
          },
          signal_stack: { evaluated: 0, passed: 0, failed: 0, fail_reasons: {} },
          stage1: { total: 0, reasons: {} },
          stage2: { total: 0, reasons: {}, passed: 0 },
          stage3_entries: 0,
          stage4: 0,
          stage5: 0,
          stage6: 0,
          passed: 0,
        },
        last_passed_tokens: [],
        bot_health: null,
        lastUpdated: new Date().toISOString(),
        redisError: `Redis indisponível: ${errMsg}. Configure REDIS_URL ou REDIS_HOST/REDIS_PORT no dashboard.`,
      } satisfies DiagnosticsResponse);
    }
  }

  const pipeline: DiagnosticsResponse['pipeline'] = {
    tokens_received: 0,
    pre_pipeline: {
      logs_no_token: 0,
      listener_liquidity_below: 0,
      scanner_skip_cache: 0,
      scanner_skip_no_mint: 0,
      scanner_skip_account_not_found: 0,
      scanner_skip_error: 0,
      pool_not_found: 0,
      swap_gate_deferred: 0,
      swap_gate_dropped: 0,
      institutional_filtered: 0,
    },
    signal_stack: { evaluated: 0, passed: 0, failed: 0, fail_reasons: {} },
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

  // Pre-pipeline counters
  pipeline.pre_pipeline.logs_no_token = await getInt('diag:logs_no_token_detected');
  pipeline.pre_pipeline.listener_liquidity_below = await getInt('diag:listener_liquidity_below');
  pipeline.pre_pipeline.scanner_skip_cache = await getInt('diag:scanner_skip:cache');
  pipeline.pre_pipeline.scanner_skip_no_mint = await getInt('diag:scanner_skip:no_mint');
  pipeline.pre_pipeline.scanner_skip_account_not_found = await getInt('diag:scanner_skip:account_not_found');
  pipeline.pre_pipeline.scanner_skip_error = await getInt('diag:scanner_skip:error');
  pipeline.pre_pipeline.pool_not_found = await getInt('diag:pool_not_found');
  pipeline.pre_pipeline.swap_gate_deferred = await getInt('diag:swap_gate_deferred');
  pipeline.pre_pipeline.swap_gate_dropped = await getInt('diag:swap_gate_dropped');
  pipeline.pre_pipeline.institutional_filtered = await getInt('diag:institutional_filtered');

  // Signal Stack counters
  pipeline.signal_stack.evaluated = await getInt('diag:signal_stack_evaluated');
  pipeline.signal_stack.passed = await getInt('diag:signal_stack_passed');
  pipeline.signal_stack.failed = await getInt('diag:signal_stack_failed');

  // Signal Stack per-condition failure reasons (scan for keys matching pattern)
  const SIGNAL_STACK_FAIL_REASONS = [
    'pool_age_too_low', 'liquidity_below_threshold', 'holder_count_too_low',
    'top_holder_too_high', 'top5_holder_too_high', 'top10_holder_too_high',
    'mint_authority_active', 'freeze_authority_set', 'buy_tx_too_low',
    'token_blacklisted', 'rug_score_too_low',
  ] as const;
  for (const reason of SIGNAL_STACK_FAIL_REASONS) {
    const val = await getInt(`diag:signal_stack_fail:${reason}`);
    if (val > 0) pipeline.signal_stack.fail_reasons[reason] = val;
  }

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
        tradeBlockReason?: string;
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
        tradeBlockReason: o.tradeBlockReason,
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
        tradeBlockReason: undefined,
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
