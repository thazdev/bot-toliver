import type { VersionedTransaction } from '@solana/web3.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { logger } from '../utils/logger.js';
import { retry } from '../utils/retry.js';
import { TRADE_RETRY_ATTEMPTS, TRADE_RETRY_DELAY_MS } from '../utils/constants.js';

/**
 * Sends signed Solana transactions with retry logic and confirmation.
 * Uses sendRawTransaction and confirms with 'confirmed' commitment.
 */
export class TransactionSender {
  private connectionManager: ConnectionManager;

  constructor() {
    this.connectionManager = ConnectionManager.getInstance();
  }

  /**
   * Sends a signed transaction with retry and confirmation.
   * @param transaction - The signed VersionedTransaction to send
   * @returns The transaction signature
   */
  async sendAndConfirm(transaction: VersionedTransaction): Promise<string> {
    const connection = this.connectionManager.getConnection();
    const rateLimiter = this.connectionManager.getRateLimiter();

    const signature = await retry(
      async () => {
        const rawTx = transaction.serialize();

        const txSignature = await rateLimiter.schedule(() =>
          connection.sendRawTransaction(rawTx, {
            skipPreflight: true,
            maxRetries: 2,
          }),
        );

        logger.info('Transaction sent, awaiting confirmation', { signature: txSignature });

        const confirmation = await rateLimiter.schedule(() =>
          connection.confirmTransaction(txSignature, 'confirmed'),
        );

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        logger.info('Transaction confirmed', { signature: txSignature });
        return txSignature;
      },
      TRADE_RETRY_ATTEMPTS,
      TRADE_RETRY_DELAY_MS,
      2,
    );

    return signature;
  }

  /**
   * Sends a transaction without waiting for confirmation (fire-and-forget).
   * @param transaction - The signed VersionedTransaction to send
   * @returns The transaction signature
   */
  async sendOnly(transaction: VersionedTransaction): Promise<string> {
    const connection = this.connectionManager.getConnection();
    const rateLimiter = this.connectionManager.getRateLimiter();
    const rawTx = transaction.serialize();

    const signature = await rateLimiter.schedule(() =>
      connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
      }),
    );

    logger.debug('Transaction sent (no confirmation wait)', { signature });
    return signature;
  }
}
