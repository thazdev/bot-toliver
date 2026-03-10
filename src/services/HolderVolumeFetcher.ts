/**
 * Busca holder count e top holder % via Helius DAS API (getTokenAccounts).
 * Usa HELIUS_RPC_URL já configurado.
 * Cache Redis com TTL de 300s para reduzir requests.
 */
import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import type { HolderData } from '../types/strategy.types.js';

const HOLDER_CACHE_TTL_SEC = 300;

interface TokenAccount {
  owner: string;
  amount: number;
}

interface GetTokenAccountsResponse {
  result?: {
    token_accounts?: TokenAccount[];
    total?: number;
  };
  error?: { message: string };
}

export interface HolderVolumeResult {
  holderData: HolderData;
  /** Se os dados são reais (true) ou fallback (false) */
  fromApi: boolean;
}

export class HolderVolumeFetcher {
  private heliusRpcUrl: string;
  private lastErrorAt = 0;

  constructor(heliusRpcUrl: string) {
    this.heliusRpcUrl = heliusRpcUrl;
  }

  /**
   * Busca holder count e top holder % via Helius getTokenAccounts.
   * Para tokens novos, 1 página (até 500) é suficiente.
   */
  async fetchHolderData(mintAddress: string): Promise<HolderVolumeResult> {
    const cacheKey = `holder:${mintAddress}`;
    try {
      const redis = RedisClient.getInstance().getClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug('HolderVolumeFetcher: cache hit', { mint: mintAddress.slice(0, 12) });
        return JSON.parse(cached) as HolderVolumeResult;
      }
    } catch {
      // Redis falhou — continuar sem cache
    }

    try {
      const body = {
        jsonrpc: '2.0',
        id: 'holder-fetch',
        method: 'getTokenAccounts',
        params: {
          mint: mintAddress,
          page: 1,
          limit: 500,
        },
      };

      const res = await fetch(this.heliusRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as GetTokenAccountsResponse;

      if (data.error) {
        throw new Error(data.error.message ?? 'Helius getTokenAccounts error');
      }

      const accounts = data.result?.token_accounts ?? [];
      if (accounts.length === 0) {
        return {
          holderData: {
            holderCount: 0,
            topHolderPercent: 0,
            top5HolderPercent: 0,
            holderGrowthRate: 0,
            holdersDecreasing: false,
          },
          fromApi: true,
        };
      }

      // Agrupa por owner (uma wallet pode ter múltiplas contas) e soma amounts
      const byOwner = new Map<string, number>();
      for (const acc of accounts) {
        const amt = acc.amount ?? 0;
        const cur = byOwner.get(acc.owner) ?? 0;
        byOwner.set(acc.owner, cur + amt);
      }

      const holderCount = byOwner.size;
      const amounts = [...byOwner.values()].sort((a, b) => b - a);
      const total = amounts.reduce((s, a) => s + a, 0);

      const top1 = amounts[0] ?? 0;
      const top5 = amounts.slice(0, 5).reduce((s, a) => s + a, 0);
      const topHolderPercent = total > 0 ? (top1 / total) * 100 : 0;
      const top5HolderPercent = total > 0 ? (top5 / total) * 100 : 0;

      const result: HolderVolumeResult = {
        holderData: {
          holderCount,
          topHolderPercent,
          top5HolderPercent,
          holderGrowthRate: 0,
          holdersDecreasing: false,
        },
        fromApi: true,
      };

      try {
        const redis = RedisClient.getInstance().getClient();
        await redis.set(cacheKey, JSON.stringify(result), 'EX', HOLDER_CACHE_TTL_SEC);
      } catch {
        // Non-critical
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const now = Date.now();
      if (now - this.lastErrorAt > 60_000) {
        this.lastErrorAt = now;
        logger.warn('HolderVolumeFetcher: falha ao buscar holders (throttled)', {
          mint: mintAddress.slice(0, 12),
          error: msg,
        });
      }
      return {
        holderData: {
          holderCount: 0,
          topHolderPercent: 0,
          top5HolderPercent: 0,
          holderGrowthRate: 0,
          holdersDecreasing: false,
        },
        fromApi: false,
      };
    }
  }

  /**
   * Retorna os endereços dos top N holders (ordenados por amount decrescente).
   * Usado por DevClusterDetector para análise de insider funding.
   */
  async getTopHolderAddresses(mintAddress: string, limit: number = 10): Promise<string[]> {
    try {
      const body = {
        jsonrpc: '2.0',
        id: 'holder-addresses',
        method: 'getTokenAccounts',
        params: {
          mint: mintAddress,
          page: 1,
          limit: 500,
        },
      };

      const res = await fetch(this.heliusRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as GetTokenAccountsResponse;
      if (data.error) return [];

      const accounts = data.result?.token_accounts ?? [];
      const byOwner = new Map<string, number>();
      for (const acc of accounts) {
        const amt = acc.amount ?? 0;
        const cur = byOwner.get(acc.owner) ?? 0;
        byOwner.set(acc.owner, cur + amt);
      }

      const sorted = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);
      return sorted.slice(0, limit).map(([addr]) => addr);
    } catch {
      return [];
    }
  }
}
