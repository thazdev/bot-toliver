import { logger } from '../utils/logger.js';
import { VolumeScanner, type VolumeData } from '../scanners/VolumeScanner.js';

/**
 * Tracks volume anomalies per token using VolumeScanner data.
 * Detects sudden spikes in trading activity.
 */
export class VolumeMonitor {
  private volumeScanner: VolumeScanner;
  private baselineVolumes: Map<string, number> = new Map();

  constructor() {
    this.volumeScanner = new VolumeScanner();
  }

  /**
   * Gets the current volume data for a token.
   * @param tokenMint - The token mint address
   * @returns Current VolumeData
   */
  async getVolume(tokenMint: string): Promise<VolumeData> {
    return this.volumeScanner.getVolume(tokenMint);
  }

  /**
   * Records a swap and checks for volume anomalies.
   * @param tokenMint - The token mint address
   * @param volumeSol - Swap volume in SOL
   * @returns True if the volume is anomalous (spike detected)
   */
  async recordAndCheck(tokenMint: string, volumeSol: number): Promise<boolean> {
    await this.volumeScanner.recordSwap(tokenMint, volumeSol);

    const volume = await this.volumeScanner.getVolume(tokenMint);
    const baseline = this.baselineVolumes.get(tokenMint) ?? 0;

    if (baseline > 0 && volume.txCount5m > baseline * 3) {
      logger.debug('VolumeMonitor: volume spike detected', {
        tokenMint,
        currentTxCount5m: volume.txCount5m,
        baseline,
      });
      return true;
    }

    if (volume.txCount1h > 0 && baseline === 0) {
      this.baselineVolumes.set(tokenMint, Math.max(volume.txCount5m, 1));
    }

    return false;
  }

  /**
   * Updates the baseline volume for a token.
   * @param tokenMint - The token mint address
   * @param baseline - Baseline transaction count per 5m window
   */
  setBaseline(tokenMint: string, baseline: number): void {
    this.baselineVolumes.set(tokenMint, baseline);
  }
}
