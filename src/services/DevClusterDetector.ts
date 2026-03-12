/**
 * Dev Wallet / Insider Funding Cluster Detection — detecta quando múltiplos
 * holders foram financiados pela mesma wallet (controle oculto de supply).
 *
 * Heurísticas:
 * - ≥3 holders no mesmo grupo (fundingWallet ou fundingWalletParent) → dev cluster
 * - ≥4 holders no mesmo bloco ou ±3 slots → dev cluster
 *
 * Filtros:
 * - Hot wallet: funding wallet com >1000 txs é ignorada (CEX)
 *
 * Funding chains (1-hop): A funds B, B funds C e D → C e D no mesmo cluster.
 *
 * Executado apenas quando pool_age ≥ 30s (gate no InstitutionalRiskFilters).
 */
import { PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { HolderVolumeFetcher } from './HolderVolumeFetcher.js';
import { RedisClient } from '../core/cache/RedisClient.js';

const TOP_HOLDERS_LIMIT = 10;
const MAX_TXS_PER_HOLDER = 8;
const INSIDER_FUNDING_THRESHOLD = 4;
const DEV_CLUSTER_SLOT_THRESHOLD = 5;
const SLOT_WINDOW = 3;
const HOT_WALLET_TX_THRESHOLD = 1000;
const CACHE_TTL_SEC = 120;
const TX_COUNT_CACHE_TTL_SEC = 300;

export interface FundingRecord {
  holder: string;
  fundingSource: string | null;
  fundingSourceParent: string | null; // 1-hop: primeira funding da funding wallet
  slot: number;
  blockTime: number | null;
}

export interface DevClusterResult {
  detected: boolean;
  reason?: string;
  sharedFundingCount?: number;
  holdersInSameSlotWindow?: number;
}

export class DevClusterDetector {
  constructor(private holderVolumeFetcher: HolderVolumeFetcher) {}

  async detect(tokenMint: string): Promise<DevClusterResult> {
    const topHolders = await this.holderVolumeFetcher.getTopHolderAddresses(
      tokenMint,
      TOP_HOLDERS_LIMIT,
    );

    if (topHolders.length < 3) {
      return { detected: false };
    }

    const connection = ConnectionManager.getInstance().getConnection();
    const rateLimiter = ConnectionManager.getInstance().getRateLimiter();
    const records: FundingRecord[] = [];

    for (const holder of topHolders) {
      const funding = await this.findFundingSource(holder, connection, rateLimiter, tokenMint);
      if (funding) {
        records.push(funding);
      }
    }

    return this.applyHeuristics(records, connection, rateLimiter);
  }

  private async isHotWallet(
    wallet: string,
    connection: ReturnType<typeof ConnectionManager.prototype.getConnection>,
    rateLimiter: ReturnType<typeof ConnectionManager.prototype.getRateLimiter>,
  ): Promise<boolean> {
    const cacheKey = `dev_cluster:txcount:${wallet}`;
    try {
      const redis = RedisClient.getInstance().getClient();
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        const count = parseInt(cached, 10);
        return count > HOT_WALLET_TX_THRESHOLD;
      }
    } catch {
      // Non-critical
    }

    try {
      const pubkey = new PublicKey(wallet);
      const sigs = await rateLimiter.schedule(() =>
        connection.getSignaturesForAddress(pubkey, { limit: HOT_WALLET_TX_THRESHOLD + 1 }),
      );
      const count = sigs.length;

      try {
        const redis = RedisClient.getInstance().getClient();
        await redis.set(cacheKey, String(count), 'EX', TX_COUNT_CACHE_TTL_SEC);
      } catch {
        // Non-critical
      }

      return count > HOT_WALLET_TX_THRESHOLD;
    } catch {
      return false; // Em caso de erro, não tratar como hot wallet
    }
  }

  private async findFundingSource(
    holder: string,
    connection: ReturnType<typeof ConnectionManager.prototype.getConnection>,
    rateLimiter: ReturnType<typeof ConnectionManager.prototype.getRateLimiter>,
    tokenMint: string,
  ): Promise<FundingRecord | null> {
    const cacheKey = `dev_cluster:funding:${holder}`;
    try {
      const redis = RedisClient.getInstance().getClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as FundingRecord;
      }
    } catch {
      // Non-critical
    }

    try {
      const holderPubkey = new PublicKey(holder);
      const sigs = await rateLimiter.schedule(() =>
        connection.getSignaturesForAddress(holderPubkey, {
          limit: MAX_TXS_PER_HOLDER,
        }),
      );

      if (sigs.length === 0) return null;

      const sigsWithTime = sigs.filter((s) => s.blockTime != null);
      sigsWithTime.sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));

      for (const sig of sigsWithTime) {
        try {
          const tx = await rateLimiter.schedule(() =>
            connection.getTransaction(sig.signature, { maxSupportedTransactionVersion: 0 }),
          );

          if (!tx?.meta?.preBalances || !tx.transaction?.message) continue;

          const accountKeys = tx.transaction.message.getAccountKeys
            ? tx.transaction.message.getAccountKeys().staticAccountKeys
            : [];
          const preBalances = tx.meta.preBalances;
          const postBalances = tx.meta.postBalances;

          const holderIdx = accountKeys.findIndex((k) => k?.toBase58() === holder);
          if (holderIdx < 0) continue;

          const holderPre = preBalances[holderIdx] ?? 0;
          const holderPost = postBalances[holderIdx] ?? 0;
          const holderGain = holderPost - holderPre;

          if (holderGain <= 0) continue;

          let fundingSource: string | null = null;
          for (let i = 0; i < accountKeys.length; i++) {
            if (i === holderIdx) continue;
            const pre = preBalances[i] ?? 0;
            const post = postBalances[i] ?? 0;
            if (post < pre) {
              fundingSource = accountKeys[i]?.toBase58() ?? null;
              break;
            }
          }

          if (fundingSource) {
            const record: FundingRecord = {
              holder,
              fundingSource,
              fundingSourceParent: null, // Preenchido em applyHeuristics se necessário
              slot: tx.slot,
              blockTime: tx.blockTime ?? null,
            };
            try {
              const redis = RedisClient.getInstance().getClient();
              await redis.set(cacheKey, JSON.stringify(record), 'EX', CACHE_TTL_SEC);
            } catch {
              // Non-critical
            }
            return record;
          }
        } catch {
          // Ignora tx falha
        }
      }

      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug('DevClusterDetector: erro ao buscar funding', {
        holder: holder.slice(0, 8),
        mint: tokenMint.slice(0, 12),
        error: msg,
      });
      return null;
    }
  }

  private async findFundingSourceParent(
    fundingWallet: string,
    connection: ReturnType<typeof ConnectionManager.prototype.getConnection>,
    rateLimiter: ReturnType<typeof ConnectionManager.prototype.getRateLimiter>,
  ): Promise<string | null> {
    const cacheKey = `dev_cluster:funding_parent:${fundingWallet}`;
    try {
      const redis = RedisClient.getInstance().getClient();
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        return cached === '' ? null : cached;
      }
    } catch {
      // Non-critical
    }

    try {
      const pubkey = new PublicKey(fundingWallet);
      const sigs = await rateLimiter.schedule(() =>
        connection.getSignaturesForAddress(pubkey, { limit: MAX_TXS_PER_HOLDER }),
      );

      const sigsWithTime = sigs.filter((s) => s.blockTime != null);
      sigsWithTime.sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));

      for (const sig of sigsWithTime) {
        try {
          const tx = await rateLimiter.schedule(() =>
            connection.getTransaction(sig.signature, { maxSupportedTransactionVersion: 0 }),
          );

          if (!tx?.meta?.preBalances || !tx.transaction?.message) continue;

          const accountKeys = tx.transaction.message.getAccountKeys
            ? tx.transaction.message.getAccountKeys().staticAccountKeys
            : [];
          const preBalances = tx.meta.preBalances;
          const postBalances = tx.meta.postBalances;

          const walletIdx = accountKeys.findIndex((k) => k?.toBase58() === fundingWallet);
          if (walletIdx < 0) continue;

          const pre = preBalances[walletIdx] ?? 0;
          const post = postBalances[walletIdx] ?? 0;
          const gain = post - pre;

          if (gain <= 0) continue;

          for (let i = 0; i < accountKeys.length; i++) {
            if (i === walletIdx) continue;
            const p = preBalances[i] ?? 0;
            const po = postBalances[i] ?? 0;
            if (po < p) {
              const parent = accountKeys[i]?.toBase58() ?? null;
              try {
                const redis = RedisClient.getInstance().getClient();
                await redis.set(cacheKey, parent ?? '', 'EX', CACHE_TTL_SEC);
              } catch {
                // Non-critical
              }
              return parent;
            }
          }
        } catch {
          // Ignora
        }
      }

      try {
        const redis = RedisClient.getInstance().getClient();
        await redis.set(cacheKey, '', 'EX', CACHE_TTL_SEC);
      } catch {
        // Non-critical
      }
      return null;
    } catch {
      return null;
    }
  }

  private async applyHeuristics(
    records: FundingRecord[],
    connection: ReturnType<typeof ConnectionManager.prototype.getConnection>,
    rateLimiter: ReturnType<typeof ConnectionManager.prototype.getRateLimiter>,
  ): Promise<DevClusterResult> {
    // Filtrar hot wallets e enriquecer com fundingSourceParent
    const validRecords: FundingRecord[] = [];
    for (const r of records) {
      if (!r.fundingSource) continue;
      const isHot = await this.isHotWallet(r.fundingSource, connection, rateLimiter);
      if (isHot) continue; // Ignora funding de CEX/hot wallet

      const parent = await this.findFundingSourceParent(r.fundingSource, connection, rateLimiter);
      validRecords.push({
        ...r,
        fundingSourceParent: parent,
      });
    }

    // Union-find para grupos: fundingWallet ou fundingWalletParent
    const groupRoot = new Map<string, string>();

    function findRoot(key: string): string {
      if (!groupRoot.has(key)) {
        groupRoot.set(key, key);
      }
      let r = groupRoot.get(key)!;
      while (groupRoot.get(r) !== r) {
        r = groupRoot.get(r)!;
      }
      // Path compression
      let cur = key;
      while (groupRoot.get(cur) !== r) {
        const next = groupRoot.get(cur)!;
        groupRoot.set(cur, r);
        cur = next;
      }
      return r;
    }

    function union(a: string, b: string): void {
      if (!a || !b) return;
      const ra = findRoot(a);
      const rb = findRoot(b);
      if (ra !== rb) {
        groupRoot.set(ra, rb);
      }
    }

    for (const r of validRecords) {
      if (r.fundingSource) {
        findRoot(r.fundingSource);
        if (r.fundingSourceParent) {
          union(r.fundingSource, r.fundingSourceParent);
        }
      }
    }

    // Contar holders por grupo
    const groupHolders = new Map<string, string[]>();
    for (const r of validRecords) {
      if (!r.fundingSource) continue;
      const root = findRoot(r.fundingSource);
      const list = groupHolders.get(root) ?? [];
      if (!list.includes(r.holder)) {
        list.push(r.holder);
      }
      groupHolders.set(root, list);
    }

    for (const [_, holders] of groupHolders) {
      if (holders.length >= INSIDER_FUNDING_THRESHOLD) {
        logger.debug('DevClusterDetector: insider funding cluster detectado', {
          holderCount: holders.length,
        });
        return {
          detected: true,
          reason: `insider_funding: ${holders.length} holders no mesmo grupo de funding`,
          sharedFundingCount: holders.length,
        };
      }
    }

    // Heurística slot: ≥4 holders no mesmo bloco ou ±3 slots
    const slots = validRecords.map((r) => r.slot).sort((a, b) => a - b);
    for (let i = 0; i < slots.length; i++) {
      const baseSlot = slots[i];
      const inWindow = slots.filter(
        (s) => s >= baseSlot - SLOT_WINDOW && s <= baseSlot + SLOT_WINDOW,
      ).length;
      if (inWindow >= DEV_CLUSTER_SLOT_THRESHOLD) {
        logger.debug('DevClusterDetector: dev cluster detectado (mesmo slot window)', {
          slotWindow: inWindow,
          baseSlot,
        });
        return {
          detected: true,
          reason: `dev_cluster: ${inWindow} holders no mesmo bloco ou ±${SLOT_WINDOW} slots`,
          holdersInSameSlotWindow: inWindow,
        };
      }
    }

    return { detected: false };
  }
}
