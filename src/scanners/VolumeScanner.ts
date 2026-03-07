import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';

export interface VolumeData {
  txCount5m: number;
  txCount1h: number;
  estimatedVolumeSol: number;
}

/**
 * Tracks swap transaction counts per token per time window.
 * Uses Redis expiring keys for 5-minute and 1-hour windows.
 */
export class VolumeScanner {
  private redis: RedisClient;

  constructor() {
    this.redis = RedisClient.getInstance();
  }

  /**
   * Records a swap transaction for a token.
   * @param tokenMint - The token mint address
   * @param volumeSol - The volume of this swap in SOL
   */
  async recordSwap(tokenMint: string, volumeSol: number): Promise<void> {
    try {
      const client = this.redis.getClient();
      const now = Math.floor(Date.now() / 1000);

      const key5m = `volume:5m:${tokenMint}:${Math.floor(now / 300)}`;
      const key1h = `volume:1h:${tokenMint}:${Math.floor(now / 3600)}`;
      const volKey5m = `vol_sol:5m:${tokenMint}:${Math.floor(now / 300)}`;
      const volKey1h = `vol_sol:1h:${tokenMint}:${Math.floor(now / 3600)}`;

      const pipeline = client.pipeline();
      pipeline.incr(key5m);
      pipeline.expire(key5m, 600);
      pipeline.incr(key1h);
      pipeline.expire(key1h, 7200);
      pipeline.incrbyfloat(volKey5m, volumeSol);
      pipeline.expire(volKey5m, 600);
      pipeline.incrbyfloat(volKey1h, volumeSol);
      pipeline.expire(volKey1h, 7200);
      await pipeline.exec();
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('VolumeScanner: failed to record swap', {
        tokenMint,
        error: errorMsg,
      });
    }
  }

  /**
   * Gets volume data for a token.
   * @param tokenMint - The token mint address
   * @returns VolumeData with transaction counts and estimated volume
   */
  async getVolume(tokenMint: string): Promise<VolumeData> {
    try {
      const client = this.redis.getClient();
      const now = Math.floor(Date.now() / 1000);

      const key5m = `volume:5m:${tokenMint}:${Math.floor(now / 300)}`;
      const key1h = `volume:1h:${tokenMint}:${Math.floor(now / 3600)}`;
      const volKey1h = `vol_sol:1h:${tokenMint}:${Math.floor(now / 3600)}`;

      const pipeline = client.pipeline();
      pipeline.get(key5m);
      pipeline.get(key1h);
      pipeline.get(volKey1h);
      const results = await pipeline.exec();

      if (!results) {
        return { txCount5m: 0, txCount1h: 0, estimatedVolumeSol: 0 };
      }

      const txCount5m = parseInt((results[0]?.[1] as string) ?? '0', 10);
      const txCount1h = parseInt((results[1]?.[1] as string) ?? '0', 10);
      const estimatedVolumeSol = parseFloat((results[2]?.[1] as string) ?? '0');

      return { txCount5m, txCount1h, estimatedVolumeSol };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('VolumeScanner: failed to get volume', {
        tokenMint,
        error: errorMsg,
      });
      return { txCount5m: 0, txCount1h: 0, estimatedVolumeSol: 0 };
    }
  }
}
