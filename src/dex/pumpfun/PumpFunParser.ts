import { logger } from '../../utils/logger.js';

/** Discriminator sha256("account:BondingCurve")[0:8] */
const BONDING_CURVE_DISCRIMINATOR = Buffer.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]);
const MIN_BONDING_CURVE_SIZE = 49; // 8 + 5*8 + 1

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
 * Layout: 8b discriminator + virtualToken(8) + virtualSol(8) + realToken(8) + realSol(8) + tokenTotalSupply(8) + complete(1).
 * O bonding curve NÃO contém tokenMint — ele é derivado via PDA a partir do mint.
 */
export class PumpFunParser {
  static parse(data: Buffer): PumpFunBondingCurveState | null {
    try {
      if (data.length < MIN_BONDING_CURVE_SIZE) {
        logger.debug('PumpFunParser: data too short', { length: data.length, min: MIN_BONDING_CURVE_SIZE });
        return null;
      }
      if (data.subarray(0, 8).compare(BONDING_CURVE_DISCRIMINATOR) !== 0) {
        logger.debug('PumpFunParser: invalid discriminator', { first8: data.slice(0, 8).toString('hex') });
        return null;
      }

      const virtualTokenReserves = data.readBigUInt64LE(8);
      const virtualSolReserves = data.readBigUInt64LE(16);
      const realTokenReserves = data.readBigUInt64LE(24);
      const realSolReserves = data.readBigUInt64LE(32);
      const complete = data[48] === 1;

      return {
        virtualTokenReserves,
        virtualSolReserves,
        realTokenReserves,
        realSolReserves,
        tokenMint: '',
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
