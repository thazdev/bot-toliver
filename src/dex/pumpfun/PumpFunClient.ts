import { PublicKey, type GetProgramAccountsFilter } from '@solana/web3.js';
import { BaseDex } from '../BaseDex.js';
import { PumpFunParser } from './PumpFunParser.js';
import { ConnectionManager } from '../../core/connection/ConnectionManager.js';
import { logger } from '../../utils/logger.js';
import { PUMP_FUN_PROGRAM, WSOL_MINT } from '../../utils/constants.js';
import type { PoolInfo } from '../../types/pool.types.js';

/**
 * Pump.fun DEX client.
 * Fetches bonding curve data, prices, and liquidity from Pump.fun program accounts.
 */
export class PumpFunClient extends BaseDex {
  readonly name = 'PumpFun';
  readonly programId = PUMP_FUN_PROGRAM;
  private connectionManager: ConnectionManager;
  private lastFetchPoolErrorAt = 0;

  constructor() {
    super();
    this.connectionManager = ConnectionManager.getInstance();
  }

  /**
   * Fetches bonding curve pool info for a given token mint.
   * @param mintAddress - The token mint address
   * @returns PoolInfo or null
   */
  async getPool(mintAddress: string): Promise<PoolInfo | null> {
    try {
      const rateLimiter = this.connectionManager.getRateLimiter();
      const connection = this.connectionManager.getConnection();
      const programPubkey = new PublicKey(this.programId);

      const filters: GetProgramAccountsFilter[] = [
        {
          memcmp: {
            offset: 40,
            bytes: mintAddress,
          },
        },
      ];

      const accounts = await rateLimiter.schedule(() =>
        connection.getProgramAccounts(programPubkey, { filters }),
      );

      if (accounts.length === 0) {
        return null;
      }

      const account = accounts[0];
      const state = PumpFunParser.parse(account.account.data as Buffer);
      if (!state) {
        return null;
      }

      const price = PumpFunParser.calculatePrice(state);
      const liquidity = Number(state.virtualSolReserves) / 1_000_000_000;

      return {
        poolAddress: account.pubkey.toBase58(),
        tokenMint: state.tokenMint || mintAddress,
        quoteMint: WSOL_MINT,
        dex: 'pumpfun',
        liquidity,
        price,
        volume24h: 0,
        createdAt: new Date(),
        isActive: !state.complete,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const now = Date.now();
      if (now - this.lastFetchPoolErrorAt > 30_000) {
        this.lastFetchPoolErrorAt = now;
        logger.warn('PumpFunClient: failed to fetch pool (throttled)', { mintAddress, error: errorMsg });
      } else {
        logger.debug('PumpFunClient: failed to fetch pool', { mintAddress, error: errorMsg });
      }
      return null;
    }
  }

  /**
   * Fetches pool info by pool/bonding curve address (getAccountInfo = 1 crédito vs getProgramAccounts = 10).
   */
  async getPoolByAddress(poolAddress: string): Promise<PoolInfo | null> {
    try {
      const rateLimiter = this.connectionManager.getRateLimiter();
      const connection = this.connectionManager.getConnection();
      const accountInfo = await rateLimiter.schedule(() =>
        connection.getAccountInfo(new PublicKey(poolAddress)),
      );
      if (!accountInfo) return null;
      const state = PumpFunParser.parse(accountInfo.data as Buffer);
      if (!state) return null;
      const price = PumpFunParser.calculatePrice(state);
      const liquidity = Number(state.virtualSolReserves) / 1_000_000_000;
      return {
        poolAddress,
        tokenMint: state.tokenMint || '',
        quoteMint: WSOL_MINT,
        dex: 'pumpfun',
        liquidity,
        price,
        volume24h: 0,
        createdAt: new Date(),
        isActive: !state.complete,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetches the current price of a token from the bonding curve.
   * @param mintAddress - The token mint address
   * @returns Price in SOL
   */
  async getPrice(mintAddress: string): Promise<number> {
    try {
      const pool = await this.getPool(mintAddress);
      return pool?.price ?? 0;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PumpFunClient: failed to fetch price', { mintAddress, error: errorMsg });
      return 0;
    }
  }

  /**
   * Fetches the current liquidity of a bonding curve pool.
   * @param poolAddress - The bonding curve account address
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

      const state = PumpFunParser.parse(accountInfo.data as Buffer);
      if (!state) {
        return 0;
      }

      return Number(state.virtualSolReserves) / 1_000_000_000;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PumpFunClient: failed to fetch liquidity', { poolAddress, error: errorMsg });
      return 0;
    }
  }
}
