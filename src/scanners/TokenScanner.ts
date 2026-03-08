import { PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { CacheService } from '../core/cache/CacheService.js';
import { TokenRepository } from '../core/database/repositories/TokenRepository.js';
import type { TokenInfo } from '../types/token.types.js';
import type { TokenScanJobPayload } from '../types/queue.types.js';
import type { PoolScanner } from './PoolScanner.js';

/**
 * Scans and enriches newly detected tokens with on-chain data.
 * Consumes TOKEN_SCAN queue jobs, deduplicates, and enriches token metadata.
 */
export class TokenScanner {
  private connectionManager: ConnectionManager;
  private cacheService: CacheService;
  private tokenRepository: TokenRepository;
  private poolScanner: PoolScanner;
  private tokensScanned: number = 0;

  constructor(poolScanner: PoolScanner) {
    this.connectionManager = ConnectionManager.getInstance();
    this.cacheService = new CacheService();
    this.tokenRepository = new TokenRepository();
    this.poolScanner = poolScanner;
  }

  /** Motivo do skip quando processToken retorna null */
  static readonly SKIP_CACHE = 'cache';
  static readonly SKIP_NO_MINT = 'no_mint';
  static readonly SKIP_ACCOUNT_NOT_FOUND = 'account_not_found';
  static readonly SKIP_ERROR = 'error';

  /**
   * Processes a token scan job from the queue.
   * Deduplicates, fetches on-chain data, enriches, and persists.
   * @param payload - The token scan job payload
   * @returns { tokenInfo, skipReason } — tokenInfo quando ok, skipReason quando ignorado
   */
  async processToken(payload: TokenScanJobPayload): Promise<{ tokenInfo: TokenInfo | null; skipReason?: string }> {
    const mintAddress = payload.tokenInfo.mintAddress;

    if (!mintAddress) {
      return { tokenInfo: null, skipReason: TokenScanner.SKIP_NO_MINT };
    }

    try {
      const cacheKey = CacheService.buildKey('token', mintAddress);
      const cached = await this.cacheService.exists(cacheKey);
      if (cached) {
        return { tokenInfo: null, skipReason: TokenScanner.SKIP_CACHE };
      }

      const rateLimiter = this.connectionManager.getRateLimiter();
      const connection = this.connectionManager.getConnection();

      const mintPubkey = new PublicKey(mintAddress);
      const accountInfo = await rateLimiter.schedule(() =>
        connection.getAccountInfo(mintPubkey),
      );

      if (!accountInfo) {
        return { tokenInfo: null, skipReason: TokenScanner.SKIP_ACCOUNT_NOT_FOUND };
      }

      const data = accountInfo.data;
      let decimals = 0;
      let supply = '0';
      let hasFreezeAuthority = false;
      let isMutable = false;

      if (data.length >= 82) {
        decimals = data[44];
        hasFreezeAuthority = data[45] === 1;
        const supplyBytes = data.slice(36, 44);
        supply = Buffer.from(supplyBytes).readBigUInt64LE().toString();
      }

      if (accountInfo.owner.toBase58() === 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s') {
        isMutable = true;
      }

      const poolInfo = await this.poolScanner.scanForPool(mintAddress);

      const tokenInfo: TokenInfo = {
        mintAddress,
        symbol: payload.tokenInfo.symbol ?? '',
        name: payload.tokenInfo.name ?? '',
        decimals,
        supply,
        createdAt: new Date(),
        source: (payload.tokenInfo.source as TokenInfo['source']) ?? 'unknown',
        initialLiquidity: poolInfo?.liquidity ?? 0,
        initialPrice: poolInfo?.price ?? 0,
        isMutable,
        hasFreezable: hasFreezeAuthority,
        metadataUri: '',
      };

      await this.cacheService.set(cacheKey, tokenInfo, 300);
      await this.tokenRepository.upsert(tokenInfo);

      this.tokensScanned++;
      logger.info('TokenScanner: token processed', {
        mintAddress,
        decimals,
        source: tokenInfo.source,
        hasPool: !!poolInfo,
      });

      return { tokenInfo };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TokenScanner: failed to process token', {
        mintAddress,
        error: errorMsg,
      });
      return { tokenInfo: null, skipReason: TokenScanner.SKIP_ERROR };
    }
  }

  /**
   * Returns the total count of tokens scanned in this session.
   * @returns Number of tokens scanned
   */
  getTokensScanned(): number {
    return this.tokensScanned;
  }
}
