export type TokenSource = 'raydium' | 'pumpfun' | 'unknown';

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
}
