import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseClient } from '../DatabaseClient.js';
import { logger } from '../../../utils/logger.js';
import type { TokenInfo } from '../../../types/token.types.js';

interface TokenRow extends RowDataPacket {
  id: number;
  mint_address: string;
  symbol: string;
  name: string;
  decimals: number;
  supply: string;
  source: string;
  initial_liquidity_sol: number;
  initial_price_sol: number;
  is_mutable: boolean;
  has_freeze_authority: boolean;
  metadata_uri: string;
  created_at: Date;
  discovered_at: Date;
}

/**
 * Repository for token data persistence.
 */
export class TokenRepository {
  private db: DatabaseClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  /**
   * Upserts a token record, inserting if new or updating if it exists.
   * @param token - The TokenInfo to persist
   */
  async upsert(token: TokenInfo): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO tokens (
          mint_address, symbol, name, decimals, supply, source,
          initial_liquidity_sol, initial_price_sol, is_mutable,
          has_freeze_authority, metadata_uri, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          symbol = VALUES(symbol),
          name = VALUES(name),
          supply = VALUES(supply),
          initial_liquidity_sol = VALUES(initial_liquidity_sol),
          initial_price_sol = VALUES(initial_price_sol),
          is_mutable = VALUES(is_mutable),
          has_freeze_authority = VALUES(has_freeze_authority),
          metadata_uri = VALUES(metadata_uri)`,
        [
          token.mintAddress,
          token.symbol,
          token.name,
          token.decimals,
          token.supply,
          token.source,
          token.initialLiquidity,
          token.initialPrice,
          token.isMutable,
          token.hasFreezable,
          token.metadataUri,
          token.createdAt,
        ],
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TokenRepository upsert error', { mintAddress: token.mintAddress, error: errorMsg });
      throw error;
    }
  }

  /**
   * Finds a token by its mint address.
   * @param mint - The token mint address
   * @returns TokenInfo or null if not found
   */
  async findByMint(mint: string): Promise<TokenInfo | null> {
    try {
      const rows = await this.db.query<TokenRow>(
        'SELECT * FROM tokens WHERE mint_address = ?',
        [mint],
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToToken(rows[0]);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TokenRepository findByMint error', { mint, error: errorMsg });
      throw error;
    }
  }

  /**
   * Finds the most recently discovered tokens.
   * @param limit - Maximum number of tokens to return
   * @returns Array of TokenInfo
   */
  async findRecent(limit: number): Promise<TokenInfo[]> {
    try {
      const rows = await this.db.query<TokenRow>(
        'SELECT * FROM tokens ORDER BY discovered_at DESC LIMIT ?',
        [limit],
      );

      return rows.map((row) => this.mapRowToToken(row));
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TokenRepository findRecent error', { limit, error: errorMsg });
      throw error;
    }
  }

  private mapRowToToken(row: TokenRow): TokenInfo {
    return {
      mintAddress: row.mint_address,
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
      supply: row.supply,
      source: row.source as TokenInfo['source'],
      initialLiquidity: Number(row.initial_liquidity_sol),
      initialPrice: Number(row.initial_price_sol),
      isMutable: Boolean(row.is_mutable),
      hasFreezable: Boolean(row.has_freeze_authority),
      hasMintAuthority: false, // not persisted in DB — re-evaluated on scan
      metadataUri: row.metadata_uri,
      createdAt: row.created_at,
    };
  }
}
