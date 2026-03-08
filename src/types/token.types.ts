export type TokenSource = 'raydium' | 'raydium_clmm' | 'pumpfun' | 'unknown';

export interface TokenInfo {
  mintAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  supply: string;
  createdAt: Date;
  source: TokenSource;
  initialLiquidity: number;
  initialPrice: number;
  isMutable: boolean;
  hasFreezable: boolean;
  metadataUri: string;
  /** Optional: set when token is detected from pool logs */
  poolAddress?: string;
  /** Optional: DEX where the pool was created */
  dex?: 'pumpfun' | 'raydium';
}
