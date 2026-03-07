import { logger } from '../../utils/logger.js';

export interface PumpFunBondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenMint: string;
  complete: boolean;
}

/**
 * Decodes Pump.fun bonding curve account state data.
 * Parses virtual/real reserves and token mint from raw account buffer.
 */
export class PumpFunParser {
  /**
   * Parses raw bonding curve account data into PumpFunBondingCurveState.
   * @param data - Raw account data buffer
   * @returns Parsed bonding curve state or null if invalid
   */
  static parse(data: Buffer): PumpFunBondingCurveState | null {
    try {
      if (data.length < 120) {
        logger.debug('PumpFunParser: data too short', { length: data.length });
        return null;
      }

      const discriminator = data.slice(0, 8);
      const virtualTokenReserves = data.readBigUInt64LE(8);
      const virtualSolReserves = data.readBigUInt64LE(16);
      const realTokenReserves = data.readBigUInt64LE(24);
      const realSolReserves = data.readBigUInt64LE(32);
      const tokenMintBytes = data.slice(40, 72);
      const complete = data[72] === 1;

      let tokenMint = '';
      try {
        const { PublicKey } = require('@solana/web3.js') as typeof import('@solana/web3.js');
        tokenMint = new PublicKey(tokenMintBytes).toBase58();
      } catch {
        tokenMint = '';
      }

      return {
        virtualTokenReserves,
        virtualSolReserves,
        realTokenReserves,
        realSolReserves,
        tokenMint,
        complete,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PumpFunParser: failed to parse account data', { error: errorMsg });
      return null;
    }
  }

  /**
   * Calculates price from the bonding curve formula.
   * price = virtualSolReserves / virtualTokenReserves
   * @param state - Parsed bonding curve state
   * @returns Price in SOL per token
   */
  static calculatePrice(state: PumpFunBondingCurveState): number {
    if (state.virtualTokenReserves === 0n) {
      return 0;
    }
    return Number(state.virtualSolReserves) / Number(state.virtualTokenReserves);
  }
}
