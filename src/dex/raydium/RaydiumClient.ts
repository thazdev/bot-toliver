import { PublicKey, type GetProgramAccountsFilter } from '@solana/web3.js';
import { BaseDex } from '../BaseDex.js';
import { RaydiumParser } from './RaydiumParser.js';
import { ConnectionManager } from '../../core/connection/ConnectionManager.js';
import { logger } from '../../utils/logger.js';
import { RAYDIUM_AMM_V4, WSOL_MINT } from '../../utils/constants.js';
import type { PoolInfo } from '../../types/pool.types.js';

/**
 * Raydium AMM v4 DEX client.
 * Fetches pool data, prices, and liquidity from Raydium program accounts.
 */
export class RaydiumClient extends BaseDex {
  readonly name = 'Raydium';
  readonly programId = RAYDIUM_AMM_V4;
  private connectionManager: ConnectionManager;

  constructor() {
    super();
    this.connectionManager = ConnectionManager.getInstance();
  }

  /**
   * Fetches pool information for a given token mint from Raydium.
   * @param mintAddress - The token mint address
   * @returns PoolInfo or null
   */
  async getPool(mintAddress: string): Promise<PoolInfo | null> {
    try {
      const rateLimiter = this.connectionManager.getRateLimiter();
      const connection = this.connectionManager.getConnection();
      const programPubkey = new PublicKey(this.programId);

      const filters: GetProgramAccountsFilter[] = [
        { dataSize: 752 },
        {
          memcmp: {
            offset: 400,
            bytes: mintAddress,
          },
        },
      ];

      const accounts = await rateLimiter.schedule(() =>
        connection.getProgramAccounts(programPubkey, { filters }),
      );

      if (accounts.length === 0) {
        const reverseFilters: GetProgramAccountsFilter[] = [
          { dataSize: 752 },
          {
            memcmp: {
              offset: 432,
              bytes: mintAddress,
            },
          },
        ];

        const reverseAccounts = await rateLimiter.schedule(() =>
          connection.getProgramAccounts(programPubkey, { filters: reverseFilters }),
        );

        if (reverseAccounts.length === 0) {
          return null;
        }

        return this.parsePoolAccount(reverseAccounts[0].pubkey.toBase58(), reverseAccounts[0].account.data as Buffer);
      }

      return this.parsePoolAccount(accounts[0].pubkey.toBase58(), accounts[0].account.data as Buffer);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('RaydiumClient: failed to fetch pool', { mintAddress, error: errorMsg });
      return null;
    }
  }

  /**
   * Fetches pool info by pool address (getAccountInfo = 1 crédito vs getProgramAccounts = 10).
   */
  async getPoolByAddress(poolAddress: string): Promise<PoolInfo | null> {
    try {
      const rateLimiter = this.connectionManager.getRateLimiter();
      const connection = this.connectionManager.getConnection();
      const accountInfo = await rateLimiter.schedule(() =>
        connection.getAccountInfo(new PublicKey(poolAddress)),
      );
      if (!accountInfo) return null;
      return this.parsePoolAccount(poolAddress, accountInfo.data as Buffer);
    } catch {
      return null;
    }
  }

  /**
   * Fetches the current price of a token in SOL from Raydium pool reserves.
   * @param mintAddress - The token mint address
   * @returns Price in SOL
   */
  async getPrice(mintAddress: string): Promise<number> {
    try {
      const pool = await this.getPool(mintAddress);
      return pool?.price ?? 0;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('RaydiumClient: failed to fetch price', { mintAddress, error: errorMsg });
      return 0;
    }
  }

  /**
   * Fetches the current liquidity of a Raydium pool in SOL.
   * @param poolAddress - The pool account address
   * @returns Liquidity in SOL
   */
  async getLiquidity(poolAddress: string): Promise<number> {
    try {
      const rateLimiter = this.connectionManager.getRateLimiter();
      const connection = this.connectionManager.getConnection();
      const pubkey = new PublicKey(poolAddress);

      const accountInfo = await rateLimiter.schedule(() =>
        connection.getAccountInfo(pubkey),
      );

      if (!accountInfo) {
        return 0;
      }

      const state = RaydiumParser.parse(accountInfo.data as Buffer);
      if (!state) {
        return 0;
      }

      return Number(state.pcVaultAmount) / 1_000_000_000;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('RaydiumClient: failed to fetch liquidity', { poolAddress, error: errorMsg });
      return 0;
    }
  }

  private parsePoolAccount(poolAddress: string, data: Buffer): PoolInfo | null {
    const state = RaydiumParser.parse(data);
    if (!state) {
      return null;
    }

    const price = RaydiumParser.calculatePrice(state);
    const liquidity = Number(state.pcVaultAmount) / 1_000_000_000;

    return {
      poolAddress,
      tokenMint: state.coinMint,
      quoteMint: state.pcMint || WSOL_MINT,
      dex: 'raydium',
      liquidity,
      price,
      volume24h: 0,
      createdAt: new Date(),
      isActive: state.status === 1 || state.status === 6,
    };
  }
}
