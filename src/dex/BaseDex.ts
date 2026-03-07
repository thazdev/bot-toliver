import type { PoolInfo } from '../types/pool.types.js';

/**
 * Abstract base class defining the interface for all DEX integrations.
 * Each DEX implementation must provide pool data, price, and liquidity queries.
 */
export abstract class BaseDex {
  abstract readonly name: string;
  abstract readonly programId: string;

  /**
   * Fetches pool information for a given token mint.
   * @param mintAddress - The token mint address
   * @returns PoolInfo or null if no pool found
   */
  abstract getPool(mintAddress: string): Promise<PoolInfo | null>;

  /**
   * Fetches the current price of a token in SOL.
   * @param mintAddress - The token mint address
   * @returns Price in SOL or 0 if unavailable
   */
  abstract getPrice(mintAddress: string): Promise<number>;

  /**
   * Fetches the current liquidity of a pool in SOL.
   * @param poolAddress - The pool address
   * @returns Liquidity in SOL
   */
  abstract getLiquidity(poolAddress: string): Promise<number>;
}
