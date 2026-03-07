import { VersionedTransaction, type Keypair } from '@solana/web3.js';
import { logger } from '../utils/logger.js';

/**
 * Deserializes, signs, and prepares Solana transactions for submission.
 */
export class TransactionBuilder {
  /**
   * Deserializes a base64-encoded transaction and signs it with the wallet.
   * @param serializedTx - Base64-encoded serialized transaction from Jupiter
   * @param wallet - The wallet keypair to sign with
   * @returns Signed VersionedTransaction ready for sending
   */
  static buildAndSign(serializedTx: string, wallet: Keypair): VersionedTransaction {
    try {
      const txBuffer = Buffer.from(serializedTx, 'base64');
      const transaction = VersionedTransaction.deserialize(txBuffer);
      transaction.sign([wallet]);

      logger.debug('Transaction built and signed', {
        signaturesCount: transaction.signatures.length,
      });

      return transaction;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TransactionBuilder: failed to build and sign', { error: errorMsg });
      throw error;
    }
  }

  /**
   * Deserializes a base64-encoded transaction without signing.
   * @param serializedTx - Base64-encoded serialized transaction
   * @returns Deserialized VersionedTransaction
   */
  static deserialize(serializedTx: string): VersionedTransaction {
    try {
      const txBuffer = Buffer.from(serializedTx, 'base64');
      return VersionedTransaction.deserialize(txBuffer);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TransactionBuilder: failed to deserialize', { error: errorMsg });
      throw error;
    }
  }
}
