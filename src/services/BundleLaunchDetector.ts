/**
 * Bundle Launch Detection — detecta launches manipulados onde múltiplas wallets
 * compram simultaneamente logo após a criação da pool.
 *
 * Heurísticas (dispara se QUALQUER for verdadeira):
 * - ≥4 wallets em janela temporal de 2 segundos → bundle cluster
 * - ≥4 wallets no mesmo slot ou ±1 slot → bundle launch
 * - ≥5 dos primeiros 10 compradores no mesmo bloco → insider launch
 *
 * Executado apenas quando pool_age ≥ 30s (gate no InstitutionalRiskFilters).
 */
import { PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import type { PoolInfo } from '../types/pool.types.js';

const MAX_SWAPS_TO_ANALYZE = 15;
const MAX_SIGNATURES_TO_FETCH = 40;
const BUNDLE_THRESHOLD_WALLETS = 4;
const BUNDLE_THRESHOLD_SLOT_DIFF = 1;
const BUNDLE_TEMPORAL_WINDOW_SEC = 2;
const INSIDER_THRESHOLD_FIRST_10 = 5;

export interface SwapRecord {
  wallet: string;
  slot: number;
  blockTime: number | null;
  amountBought: number;
}

export interface BundleLaunchResult {
  detected: boolean;
  reason?: string;
  swapRecords: SwapRecord[];
  walletsInSameSlot?: number;
  first10InSameBlock?: number;
  /** Métrica: wallets em janela temporal de 2s */
  walletsInTemporalWindow?: number;
}

export class BundleLaunchDetector {
  /**
   * Analisa os primeiros swaps da pool para detectar bundle/insider launch.
   * Para análise imediatamente após encontrar cluster (short-circuit).
   */
  async detect(pool: PoolInfo, tokenMint: string): Promise<BundleLaunchResult> {
    const swapRecords: SwapRecord[] = [];
    const connection = ConnectionManager.getInstance().getConnection();
    const rateLimiter = ConnectionManager.getInstance().getRateLimiter();

    try {
      const poolPubkey = new PublicKey(pool.poolAddress);
      const sigs = await rateLimiter.schedule(() =>
        connection.getSignaturesForAddress(poolPubkey, {
          limit: MAX_SIGNATURES_TO_FETCH,
        }),
      );

      if (sigs.length === 0) {
        return { detected: false, swapRecords: [] };
      }

      const toProcess = sigs.slice(1, MAX_SWAPS_TO_ANALYZE + 1);

      for (const sig of toProcess) {
        if (swapRecords.length >= MAX_SWAPS_TO_ANALYZE) break;

        try {
          const tx = await rateLimiter.schedule(() =>
            connection.getTransaction(sig.signature, { maxSupportedTransactionVersion: 0 }),
          );

          if (!tx?.transaction?.message) continue;

          const accountKeys = tx.transaction.message.getAccountKeys
            ? tx.transaction.message.getAccountKeys().staticAccountKeys
            : [];

          const feePayer = accountKeys[0]?.toBase58();
          if (!feePayer) continue;

          swapRecords.push({
            wallet: feePayer,
            slot: tx.slot,
            blockTime: tx.blockTime ?? null,
            amountBought: 0,
          });

          // Short-circuit: verifica heurísticas após cada novo record
          const earlyResult = this.checkHeuristicsEarly(swapRecords);
          if (earlyResult) {
            return earlyResult;
          }
        } catch {
          // Ignora tx falha
        }
      }

      const result = this.applyHeuristics(swapRecords);
      if (result.detected) {
        logger.debug('BundleLaunchDetector: bundle/insider launch detectado', {
          mint: tokenMint.slice(0, 12),
          reason: result.reason,
          swapCount: swapRecords.length,
        });
      }

      return { ...result, swapRecords };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug('BundleLaunchDetector: erro ao analisar', {
        mint: tokenMint.slice(0, 12),
        pool: pool.poolAddress.slice(0, 12),
        error: msg,
      });
      return { detected: false, swapRecords: [] };
    }
  }

  /**
   * Verificação incremental — retorna resultado se cluster encontrado, evita fetch desnecessário.
   */
  private checkHeuristicsEarly(records: SwapRecord[]): BundleLaunchResult | null {
    if (records.length < BUNDLE_THRESHOLD_WALLETS) return null;

    // Heurística temporal: janela de 2 segundos
    const withTime = records.filter((r) => r.blockTime != null);
    if (withTime.length >= BUNDLE_THRESHOLD_WALLETS) {
      const times = withTime.map((r) => r.blockTime!);
      for (let i = 0; i < times.length; i++) {
        const base = times[i];
        const inWindow = withTime.filter(
          (r) => r.blockTime! >= base && r.blockTime! <= base + BUNDLE_TEMPORAL_WINDOW_SEC,
        );
        const uniqueWallets = new Set(inWindow.map((r) => r.wallet));
        if (uniqueWallets.size >= BUNDLE_THRESHOLD_WALLETS) {
          return {
            detected: true,
            reason: `bundle_cluster: ${uniqueWallets.size} wallets em janela de ${BUNDLE_TEMPORAL_WINDOW_SEC}s`,
            swapRecords: records,
            walletsInTemporalWindow: uniqueWallets.size,
          };
        }
      }
    }

    // Heurística slot: ±1 slot
    const slots = [...new Set(records.map((r) => r.slot))].sort((a, b) => a - b);
    for (const slot of slots) {
      const inSlotOrAdjacent = records.filter(
        (r) => r.slot >= slot - BUNDLE_THRESHOLD_SLOT_DIFF && r.slot <= slot + BUNDLE_THRESHOLD_SLOT_DIFF,
      );
      const uniqueWallets = new Set(inSlotOrAdjacent.map((r) => r.wallet));
      if (uniqueWallets.size >= BUNDLE_THRESHOLD_WALLETS) {
        return {
          detected: true,
          reason: `bundle_launch: ${uniqueWallets.size} wallets no mesmo slot ou ±${BUNDLE_THRESHOLD_SLOT_DIFF} slot`,
          swapRecords: records,
          walletsInSameSlot: uniqueWallets.size,
        };
      }
    }

    // Heurística insider: primeiros 10 no mesmo bloco
    if (records.length >= 10) {
      const first10 = records.slice(0, 10);
      const slotCounts = new Map<number, number>();
      for (const r of first10) {
        slotCounts.set(r.slot, (slotCounts.get(r.slot) ?? 0) + 1);
      }
      const maxInSlot = Math.max(...slotCounts.values(), 0);
      if (maxInSlot >= INSIDER_THRESHOLD_FIRST_10) {
        return {
          detected: true,
          reason: `insider_launch: ${maxInSlot} dos primeiros 10 compradores no mesmo bloco`,
          swapRecords: records,
          first10InSameBlock: maxInSlot,
        };
      }
    }

    return null;
  }

  private applyHeuristics(records: SwapRecord[]): BundleLaunchResult {
    if (records.length < BUNDLE_THRESHOLD_WALLETS) {
      return { detected: false, swapRecords: records };
    }

    // Heurística temporal: janela de 2 segundos
    const withTime = records.filter((r) => r.blockTime != null);
    if (withTime.length >= BUNDLE_THRESHOLD_WALLETS) {
      const times = withTime.map((r) => r.blockTime!);
      for (let i = 0; i < times.length; i++) {
        const base = times[i];
        const inWindow = withTime.filter(
          (r) => r.blockTime! >= base && r.blockTime! <= base + BUNDLE_TEMPORAL_WINDOW_SEC,
        );
        const uniqueWallets = new Set(inWindow.map((r) => r.wallet));
        if (uniqueWallets.size >= BUNDLE_THRESHOLD_WALLETS) {
          return {
            detected: true,
            reason: `bundle_cluster: ${uniqueWallets.size} wallets em janela de ${BUNDLE_TEMPORAL_WINDOW_SEC}s`,
            swapRecords: records,
            walletsInTemporalWindow: uniqueWallets.size,
          };
        }
      }
    }

    // Heurística slot: ±1 slot
    const slots = [...new Set(records.map((r) => r.slot))].sort((a, b) => a - b);
    for (const slot of slots) {
      const inSlotOrAdjacent = records.filter(
        (r) => r.slot >= slot - BUNDLE_THRESHOLD_SLOT_DIFF && r.slot <= slot + BUNDLE_THRESHOLD_SLOT_DIFF,
      );
      const uniqueWallets = new Set(inSlotOrAdjacent.map((r) => r.wallet));
      if (uniqueWallets.size >= BUNDLE_THRESHOLD_WALLETS) {
        return {
          detected: true,
          reason: `bundle_launch: ${uniqueWallets.size} wallets no mesmo slot ou ±${BUNDLE_THRESHOLD_SLOT_DIFF} slot`,
          swapRecords: records,
          walletsInSameSlot: uniqueWallets.size,
        };
      }
    }

    // Heurística insider: primeiros 10 no mesmo bloco
    const first10 = records.slice(0, 10);
    const slotCounts = new Map<number, number>();
    for (const r of first10) {
      slotCounts.set(r.slot, (slotCounts.get(r.slot) ?? 0) + 1);
    }
    const maxInSlot = Math.max(...slotCounts.values(), 0);
    if (maxInSlot >= INSIDER_THRESHOLD_FIRST_10) {
      return {
        detected: true,
        reason: `insider_launch: ${maxInSlot} dos primeiros 10 compradores no mesmo bloco`,
        swapRecords: records,
        first10InSameBlock: maxInSlot,
      };
    }

    return { detected: false, swapRecords: records };
  }
}
