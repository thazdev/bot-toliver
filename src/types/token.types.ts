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
  /** True when the mint authority COption is Some (data[0] === 1) — token supply can still be inflated */
  hasMintAuthority: boolean;
  metadataUri: string;
  /** Optional: set when token is detected from pool logs */
  poolAddress?: string;
  /** Optional: DEX where the pool was created */
  dex?: 'pumpfun' | 'raydium';
}
