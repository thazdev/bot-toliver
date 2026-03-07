import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { logger } from '../utils/logger.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { DatabaseClient } from '../core/database/DatabaseClient.js';
import type { RowDataPacket } from 'mysql2/promise';

const RECONCILIATION_TIMEOUT_MS = parseInt(process.env.RECONCILIATION_TIMEOUT_MS ?? '30000', 10);
const BALANCE_TOLERANCE_PCT = parseInt(process.env.RECONCILIATION_BALANCE_TOLERANCE_PCT ?? '5', 10);

interface PositionRow extends RowDataPacket {
  id: string;
  token_mint: string;
  token_amount: string;
  status: string;
  amount_sol: number;
}

interface ReconciliationSummary {
  totalChecked: number;
  ok: number;
  closedExternally: number;
  partialReconciled: number;
  errors: number;
}

export class StateReconciler {
  private connectionManager: ConnectionManager;

  constructor() {
    this.connectionManager = ConnectionManager.getInstance();
  }

  async reconcile(): Promise<ReconciliationSummary> {
    const summary: ReconciliationSummary = {
      totalChecked: 0,
      ok: 0,
      closedExternally: 0,
      partialReconciled: 0,
      errors: 0,
    };

    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), RECONCILIATION_TIMEOUT_MS),
    );

    const reconcilePromise = this.doReconcile(summary);

    const result = await Promise.race([reconcilePromise, timeoutPromise]);

    if (result === 'timeout') {
      logger.warn('StateReconciler: reconciliation timeout exceeded — continuing with partial results', {
        timeoutMs: RECONCILIATION_TIMEOUT_MS,
        checkedSoFar: summary.totalChecked,
      });
    }

    logger.info('StateReconciler: reconciliation complete', {
      totalChecked: summary.totalChecked,
      ok: summary.ok,
      closedExternally: summary.closedExternally,
      partialReconciled: summary.partialReconciled,
      errors: summary.errors,
    });

    return summary;
  }

  private async doReconcile(summary: ReconciliationSummary): Promise<void> {
    const db = DatabaseClient.getInstance();

    let positions: PositionRow[];
    try {
      positions = await db.query<PositionRow>(
        "SELECT id, token_mint, token_amount, status, amount_sol FROM positions WHERE status IN ('open', 'partial')",
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('StateReconciler: failed to query positions from database', { error: errorMsg });
      return;
    }

    if (positions.length === 0) {
      logger.info('StateReconciler: no open/partial positions to reconcile');
      return;
    }

    const connection = this.connectionManager.getConnection();
    const wallet = this.connectionManager.getWallet();

    for (const pos of positions) {
      summary.totalChecked++;

      try {
        const tokenMintPubkey = new PublicKey(pos.token_mint);
        const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
          mint: tokenMintPubkey,
          programId: TOKEN_PROGRAM_ID,
        });

        let onChainBalance = 0;
        for (const account of tokenAccounts.value) {
          const data = account.account.data;
          const amountBytes = data.subarray(64, 72);
          const amount = Number(amountBytes.readBigUInt64LE(0));
          onChainBalance += amount;
        }

        const dbTokenAmount = Number(pos.token_amount);

        if (onChainBalance === 0 && dbTokenAmount > 0) {
          await db.execute(
            "UPDATE positions SET status = 'closed_external', closed_at = NOW() WHERE id = ?",
            [pos.id],
          );
          summary.closedExternally++;
          logger.warn('StateReconciler: position closed externally — balance is zero', {
            positionId: pos.id,
            tokenMint: pos.token_mint.slice(0, 8),
            dbAmount: dbTokenAmount,
          });
          continue;
        }

        if (dbTokenAmount > 0) {
          const diff = Math.abs(onChainBalance - dbTokenAmount) / dbTokenAmount;
          if (diff > BALANCE_TOLERANCE_PCT / 100) {
            await db.execute(
              'UPDATE positions SET token_amount = ? WHERE id = ?',
              [onChainBalance.toString(), pos.id],
            );
            summary.partialReconciled++;
            logger.warn('StateReconciler: partial_exit_reconciled — balance mismatch corrected', {
              positionId: pos.id,
              tokenMint: pos.token_mint.slice(0, 8),
              dbAmount: dbTokenAmount,
              onChainBalance,
              diffPercent: (diff * 100).toFixed(1),
            });
            continue;
          }
        }

        summary.ok++;
      } catch (error: unknown) {
        summary.errors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('StateReconciler: error reconciling position', {
          positionId: pos.id,
          tokenMint: pos.token_mint.slice(0, 8),
          error: errorMsg,
        });
      }
    }
  }
}
