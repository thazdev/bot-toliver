/**
 * Filtros institucionais de risco — executados ANTES do Signal Stack.
 *
 * Arquitetura: Swap Activity Gate → Bundle Launch → Dev Cluster → Signal Stack → ...
 *
 * Gate: pool_age ≥ 30s para evitar falsos positivos em tokens muito novos.
 * Métricas: bundle_skipped, dev_cluster_skipped, institutional_filtered (Redis diag).
 */
import { logger } from '../utils/logger.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import { BundleLaunchDetector } from '../services/BundleLaunchDetector.js';
import { DevClusterDetector } from '../services/DevClusterDetector.js';
import { HolderVolumeFetcher } from '../services/HolderVolumeFetcher.js';
import type { PoolInfo } from '../types/pool.types.js';

const MIN_POOL_AGE_SEC = 30;
const LOG_PREFIX = '[INSTITUTIONAL FILTER]';

export interface InstitutionalRiskResult {
  passed: boolean;
  bundleLaunchDetected: boolean;
  devClusterDetected: boolean;
  reason?: string;
}

export class InstitutionalRiskFilters {
  private bundleDetector: BundleLaunchDetector;
  private devClusterDetector: DevClusterDetector;

  constructor(holderVolumeFetcher: HolderVolumeFetcher) {
    this.bundleDetector = new BundleLaunchDetector();
    this.devClusterDetector = new DevClusterDetector(holderVolumeFetcher);
  }

  /**
   * Executa Bundle Launch Detection e Dev Cluster Detection.
   * Retorna passed=false se qualquer um detectar manipulação.
   */
  async run(
    pool: PoolInfo,
    tokenMint: string,
    poolAgeSec: number,
  ): Promise<InstitutionalRiskResult> {
    if (poolAgeSec < MIN_POOL_AGE_SEC) {
      return {
        passed: true,
        bundleLaunchDetected: false,
        devClusterDetected: false,
      };
    }

    const [bundleResult, devResult] = await Promise.all([
      this.bundleDetector.detect(pool, tokenMint),
      this.devClusterDetector.detect(tokenMint),
    ]);

    if (bundleResult.detected) {
      await this.recordMetrics('bundle_skipped');
      logger.debug(`${LOG_PREFIX} Bundle launch detected → skipping token`, {
        mint: tokenMint.slice(0, 12),
        reason: bundleResult.reason,
      });
      return {
        passed: false,
        bundleLaunchDetected: true,
        devClusterDetected: false,
        reason: bundleResult.reason,
      };
    }

    if (devResult.detected) {
      await this.recordMetrics('dev_cluster_skipped');
      logger.debug(`${LOG_PREFIX} Dev funding cluster detected → skipping token`, {
        mint: tokenMint.slice(0, 12),
        reason: devResult.reason,
      });
      return {
        passed: false,
        bundleLaunchDetected: false,
        devClusterDetected: true,
        reason: devResult.reason,
      };
    }

    return {
      passed: true,
      bundleLaunchDetected: false,
      devClusterDetected: false,
    };
  }

  private async recordMetrics(specificMetric: string): Promise<void> {
    try {
      const redis = RedisClient.getInstance().getClient();
      await redis.incr(`diag:${specificMetric}`);
      await redis.incr('diag:institutional_filtered');
    } catch {
      // Non-critical
    }
  }
}
