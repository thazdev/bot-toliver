import { logger } from '../../utils/logger.js';

export interface RaydiumAmmState {
  status: number;
  coinVaultAmount: bigint;
  pcVaultAmount: bigint;
  coinMint: string;
  pcMint: string;
  lpMint: string;
}

/**
 * Decodes Raydium AMM v4 account state data.
 * Parses vault amounts and mint addresses from raw account buffer.
 */
export class RaydiumParser {
  /**
   * Parses raw account data into RaydiumAmmState.
   * @param data - Raw account data buffer
   * @returns Parsed AMM state or null if data is invalid
   */
  static parse(data: Buffer): RaydiumAmmState | null {
    try {
      if (data.length < 752) {
        logger.debug('RaydiumParser: data too short', { length: data.length });
        return null;
      }

      const status = data.readBigUInt64LE(0);
      const coinVaultAmount = data.readBigUInt64LE(64);
      const pcVaultAmount = data.readBigUInt64LE(72);

      const coinMintBytes = data.slice(400, 432);
      const pcMintBytes = data.slice(432, 464);
      const lpMintBytes = data.slice(464, 496);

      return {
        status: Number(status),
        coinVaultAmount,
        pcVaultAmount,
        coinMint: this.bytesToBase58(coinMintBytes),
        pcMint: this.bytesToBase58(pcMintBytes),
        lpMint: this.bytesToBase58(lpMintBytes),
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('RaydiumParser: failed to parse account data', { error: errorMsg });
      return null;
    }
  }

  /**
   * Calculates the price of coin in terms of PC (quote) from vault amounts.
   * @param state - Parsed AMM state
   * @returns Price ratio (pcVault / coinVault)
   */
  static calculatePrice(state: RaydiumAmmState): number {
    if (state.coinVaultAmount === 0n) {
      return 0;
    }
    return Number(state.pcVaultAmount) / Number(state.coinVaultAmount);
  }

  private static bytesToBase58(bytes: Buffer): string {
    const { PublicKey } = require('@solana/web3.js') as typeof import('@solana/web3.js');
    try {
      return new PublicKey(bytes).toBase58();
    } catch {
      return '';
    }
  }
}
