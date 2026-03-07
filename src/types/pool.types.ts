export type DexType = 'raydium' | 'pumpfun';
export type PoolEventType = 'created' | 'liquidityAdded' | 'liquidityRemoved';

export interface PoolInfo {
  poolAddress: string;
  tokenMint: string;
  quoteMint: string;
  dex: DexType;
  liquidity: number;
  price: number;
  volume24h: number;
  createdAt: Date;
  isActive: boolean;
}

export interface PoolEvent {
  type: PoolEventType;
  poolInfo: PoolInfo;
  txSignature: string;
  timestamp: number;
}
