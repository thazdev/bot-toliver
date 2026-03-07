// UPDATED: Wallet age penalty instead of reject + Dev wallet clustering - 2026-03-07
import { logger } from '../utils/logger.js';
import { SCAM_RULES } from '../strategies/config.js';
import { CacheService } from '../core/cache/CacheService.js';
import { RedisClient } from '../core/cache/RedisClient.js';
import { ConnectionManager } from '../core/connection/ConnectionManager.js';
import { PublicKey } from '@solana/web3.js';

export interface ScamCheckResult {
  isScam: boolean;
  reasons: string[];
  scorePenalty: number;
}

export interface MetadataCheckInput {
  tokenName: string;
  tokenSymbol: string;
  metadataUri: string;
  metadataHash: string | null;
  fetchedMetadataHash: string | null;
}

export interface WalletHistoryInput {
  walletAddress: string;
  walletAgeDays: number;
  tokensDeployedLast7Days: number;
  priorNonTokenTxCount: number;
  receivedFromKnownScam: boolean;
  interactedWithMixer: boolean;
}

export interface DistributionCheckInput {
  topHolderPercent: number;
  top5HolderPercent: number;
  bundleLaunchWallets: number;
  earlyWalletsFromSameSource: boolean;
  devReceivedFromContract: boolean;
}

const KNOWN_TOKEN_NAMES = [
  'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol',
  'bonk', 'wif', 'dogwifhat', 'pepe', 'shib', 'doge',
  'usdc', 'usdt', 'tether',
];

const CELEBRITY_PATTERNS = [
  /elon/i, /trump/i, /biden/i, /musk/i, /bezos/i, /gates/i,
  /drake/i, /kanye/i, /taylor/i, /swift/i,
];

export class ScamDetector {
  private cacheService: CacheService;
  private knownScamWallets: Set<string> = new Set();
  private knownScamContracts: Set<string> = new Set();
  private blacklistedLpAddresses: Set<string> = new Set();

  constructor() {
    this.cacheService = new CacheService();
  }

  async fullCheck(
    metadata: MetadataCheckInput,
    wallet: WalletHistoryInput,
    distribution: DistributionCheckInput,
  ): Promise<ScamCheckResult> {
    const reasons: string[] = [];
    let scorePenalty = 0;

    const metaResult = this.checkMetadata(metadata);
    reasons.push(...metaResult.reasons);
    scorePenalty += metaResult.scorePenalty;

    const walletResult = this.checkWalletHistory(wallet);
    reasons.push(...walletResult.reasons);
    scorePenalty += walletResult.scorePenalty;

    const distResult = this.checkDistribution(distribution);
    reasons.push(...distResult.reasons);
    scorePenalty += distResult.scorePenalty;

    const dbResult = await this.checkScamDatabase(wallet.walletAddress);
    reasons.push(...dbResult.reasons);
    scorePenalty += dbResult.scorePenalty;

    const isScam = metaResult.isScam || walletResult.isScam || distResult.isScam || dbResult.isScam;

    if (isScam) {
      logger.warn('ScamDetector: SCAM detected', {
        wallet: wallet.walletAddress.slice(0, 8),
        reasons,
        scorePenalty,
      });
    }

    return { isScam, reasons, scorePenalty };
  }

  checkMetadata(input: MetadataCheckInput): ScamCheckResult {
    const reasons: string[] = [];
    let scorePenalty = 0;
    let isScam = false;

    const nameLower = input.tokenName.toLowerCase();
    const symbolLower = input.tokenSymbol.toLowerCase();

    for (const known of KNOWN_TOKEN_NAMES) {
      const similarity = this.stringSimilarity(nameLower, known);
      if (similarity >= SCAM_RULES.copycatSimilarityThreshold && nameLower !== known) {
        reasons.push(`Copycat token name: "${input.tokenName}" similar to "${known}" (${(similarity * 100).toFixed(0)}%)`);
        isScam = true;
        break;
      }

      const symSimilarity = this.stringSimilarity(symbolLower, known);
      if (symSimilarity >= SCAM_RULES.copycatSimilarityThreshold && symbolLower !== known) {
        reasons.push(`Copycat symbol: "${input.tokenSymbol}" similar to "${known}"`);
        isScam = true;
        break;
      }
    }

    if (this.isTyposquatting(nameLower) || this.isTyposquatting(symbolLower)) {
      reasons.push(`Typosquatting detected: "${input.tokenName}" / "${input.tokenSymbol}"`);
      isScam = true;
    }

    for (const pattern of CELEBRITY_PATTERNS) {
      if (pattern.test(input.tokenName) || pattern.test(input.tokenSymbol)) {
        reasons.push(`Celebrity name abuse: "${input.tokenName}"`);
        scorePenalty += 25;
        break;
      }
    }

    if (input.metadataHash && input.fetchedMetadataHash &&
        input.metadataHash !== input.fetchedMetadataHash) {
      reasons.push('IPFS metadata hash mismatch — content may be spoofed');
      isScam = true;
    }

    return { isScam, reasons, scorePenalty };
  }

  checkWalletHistory(input: WalletHistoryInput): ScamCheckResult {
    const reasons: string[] = [];
    let scorePenalty = 0;
    let isScam = false;

    if (input.walletAgeDays < SCAM_RULES.walletAgePenaltyHours / 24) {
      reasons.push(`Wallet age < ${SCAM_RULES.walletAgePenaltyHours}h — score penalty applied`);
      scorePenalty += SCAM_RULES.walletAgePenaltyAmount;
    } else if (input.walletAgeDays < SCAM_RULES.walletAgeReduceScoreDays) {
      reasons.push(`Wallet age < ${SCAM_RULES.walletAgeReduceScoreDays} days`);
      scorePenalty += SCAM_RULES.walletAgeReduceScoreAmount;
    }

    if (input.tokensDeployedLast7Days > SCAM_RULES.maxTokensIn7Days) {
      reasons.push(`Serial deployer: ${input.tokensDeployedLast7Days} tokens in 7 days (max ${SCAM_RULES.maxTokensIn7Days})`);
      isScam = true;
    }

    if (input.receivedFromKnownScam) {
      reasons.push('Wallet received SOL from known scam wallet');
      isScam = true;
    }

    if (SCAM_RULES.zeroPriorTxReject && input.priorNonTokenTxCount === 0) {
      reasons.push('Burner wallet pattern: zero prior non-token transactions');
      isScam = true;
    }

    if (input.interactedWithMixer) {
      reasons.push('Wallet interacted with mixing/tumbling service');
      isScam = true;
    }

    return { isScam, reasons, scorePenalty };
  }

  checkDistribution(input: DistributionCheckInput): ScamCheckResult {
    const reasons: string[] = [];
    let isScam = false;

    if (input.topHolderPercent > 30) {
      reasons.push(`Top wallet holds ${input.topHolderPercent.toFixed(1)}% > 30% — extreme concentration`);
      isScam = true;
    }

    if (input.top5HolderPercent > 60) {
      reasons.push(`Top 5 wallets hold ${input.top5HolderPercent.toFixed(1)}% > 60% — cartel pattern`);
      isScam = true;
    }

    if (input.bundleLaunchWallets >= SCAM_RULES.bundleLaunchWalletThreshold) {
      reasons.push(`Bundle launch: ${input.bundleLaunchWallets} simultaneous buys — coordinated scam`);
      isScam = true;
    }

    if (input.earlyWalletsFromSameSource) {
      reasons.push('All early wallets funded from same source — sybil attack');
      isScam = true;
    }

    if (input.devReceivedFromContract) {
      reasons.push('Dev wallet received tokens directly from contract — self-allocation');
      isScam = true;
    }

    return { isScam, reasons, scorePenalty: 0 };
  }

  async checkScamDatabase(walletAddress: string): Promise<ScamCheckResult> {
    const reasons: string[] = [];
    let isScam = false;

    if (this.knownScamWallets.has(walletAddress)) {
      reasons.push('Wallet in known scam database');
      isScam = true;
    }

    try {
      const key = CacheService.buildKey('scam_wallet', walletAddress);
      const cached = await this.cacheService.get(key);
      if (cached) {
        reasons.push('Wallet flagged in cached scam database');
        isScam = true;
        this.knownScamWallets.add(walletAddress);
      }
    } catch { /* non-critical */ }

    return { isScam, reasons, scorePenalty: isScam ? 50 : 0 };
  }

  async addKnownScamWallet(address: string): Promise<void> {
    this.knownScamWallets.add(address);
    try {
      const key = CacheService.buildKey('scam_wallet', address);
      await this.cacheService.set(key, { flaggedAt: Date.now() }, SCAM_RULES.scamDbCacheTtlSeconds);
    } catch { /* non-critical */ }
  }

  async addKnownScamContract(address: string): Promise<void> {
    this.knownScamContracts.add(address);
    try {
      const key = CacheService.buildKey('scam_contract', address);
      await this.cacheService.set(key, { flaggedAt: Date.now() }, SCAM_RULES.scamDbCacheTtlSeconds);
    } catch { /* non-critical */ }
  }

  async addBlacklistedLp(address: string): Promise<void> {
    this.blacklistedLpAddresses.add(address);
    try {
      const key = CacheService.buildKey('scam_lp', address);
      await this.cacheService.set(key, { flaggedAt: Date.now() }, SCAM_RULES.scamDbCacheTtlSeconds);
    } catch { /* non-critical */ }
  }

  async isBlacklistedLp(address: string): Promise<boolean> {
    if (this.blacklistedLpAddresses.has(address)) return true;
    try {
      const key = CacheService.buildKey('scam_lp', address);
      const cached = await this.cacheService.get(key);
      if (cached) {
        this.blacklistedLpAddresses.add(address);
        return true;
      }
    } catch { /* non-critical */ }
    return false;
  }

  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const maxLen = Math.max(a.length, b.length);
    const distance = this.levenshteinDistance(a, b);
    return 1 - distance / maxLen;
  }

  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost,
        );
      }
    }

    return dp[m][n];
  }

  private isTyposquatting(name: string): boolean {
    for (const known of KNOWN_TOKEN_NAMES) {
      if (name === known) continue;
      const dist = this.levenshteinDistance(name, known);
      if (dist >= 1 && dist <= 2 && name.length >= 3) {
        return true;
      }
    }
    return false;
  }

  async getDevWalletCluster(devWallet: string): Promise<string[]> {
    const DEV_CLUSTER_CACHE_TTL = parseInt(process.env.DEV_CLUSTER_CACHE_TTL_SEC ?? '3600', 10);
    const MAX_RPC_CALLS = 5;

    try {
      const cacheKey = `dev_cluster:${devWallet}`;
      const cached = await this.cacheService.get<string[]>(cacheKey);
      if (cached) {
        return cached;
      }

      let rpcCalls = 0;
      const connection = ConnectionManager.getInstance().getConnection();
      const devPubkey = new PublicKey(devWallet);

      rpcCalls++;
      const signatures = await connection.getSignaturesForAddress(devPubkey, { limit: 10 });

      if (signatures.length === 0) {
        const result = [devWallet];
        await this.cacheService.set(cacheKey, result, DEV_CLUSTER_CACHE_TTL);
        return result;
      }

      let fundingSource: string | null = null;

      for (const sig of signatures) {
        if (rpcCalls >= MAX_RPC_CALLS) break;

        rpcCalls++;
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta || !tx.transaction?.message) continue;

        const accountKeys = tx.transaction.message.getAccountKeys
          ? tx.transaction.message.getAccountKeys().staticAccountKeys
          : [];

        const preBalances = tx.meta.preBalances;
        const postBalances = tx.meta.postBalances;

        for (let i = 0; i < accountKeys.length; i++) {
          const addr = accountKeys[i]?.toBase58();
          if (!addr || addr === devWallet) continue;

          const balanceChange = (postBalances[i] ?? 0) - (preBalances[i] ?? 0);
          const devIdx = accountKeys.findIndex(k => k?.toBase58() === devWallet);
          const devBalanceChange = devIdx >= 0
            ? (postBalances[devIdx] ?? 0) - (preBalances[devIdx] ?? 0)
            : 0;

          if (balanceChange < 0 && devBalanceChange > 0) {
            fundingSource = addr;
            break;
          }
        }

        if (fundingSource) break;
      }

      if (!fundingSource) {
        const result = [devWallet];
        await this.cacheService.set(cacheKey, result, DEV_CLUSTER_CACHE_TTL);
        return result;
      }

      const cluster: string[] = [devWallet, fundingSource];
      const MAX_CLUSTER_SIZE = parseInt(process.env.DEV_CLUSTER_MAX_WALLETS ?? '50', 10);

      if (rpcCalls < MAX_RPC_CALLS) {
        rpcCalls++;
        const fundingPubkey = new PublicKey(fundingSource);
        const fundingSigs = await connection.getSignaturesForAddress(fundingPubkey, { limit: 10 });

        const totalFundingTxCount = fundingSigs.length;
        if (totalFundingTxCount >= 10) {
          logger.info('ScamDetector: funding source has high tx count — likely exchange/hub, skipping cluster expansion', {
            devWallet: devWallet.slice(0, 8),
            fundingSource: fundingSource.slice(0, 8),
            txCountSampled: totalFundingTxCount,
          });
          await this.cacheService.set(cacheKey, cluster, DEV_CLUSTER_CACHE_TTL);
          return cluster;
        }

        const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);

        for (const sig of fundingSigs) {
          if (rpcCalls >= MAX_RPC_CALLS) break;
          if (cluster.length >= MAX_CLUSTER_SIZE) break;
          if (sig.blockTime && sig.blockTime < sevenDaysAgo) continue;

          rpcCalls++;
          const tx = await connection.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });

          if (!tx?.meta || !tx.transaction?.message) continue;

          const accountKeys = tx.transaction.message.getAccountKeys
            ? tx.transaction.message.getAccountKeys().staticAccountKeys
            : [];

          const preBalances = tx.meta.preBalances;
          const postBalances = tx.meta.postBalances;

          const fundingIdx = accountKeys.findIndex(k => k?.toBase58() === fundingSource);
          if (fundingIdx < 0) continue;

          const fundingBalChange = (postBalances[fundingIdx] ?? 0) - (preBalances[fundingIdx] ?? 0);
          if (fundingBalChange >= 0) continue;

          for (let i = 0; i < accountKeys.length; i++) {
            if (i === fundingIdx) continue;
            if (cluster.length >= MAX_CLUSTER_SIZE) break;
            const addr = accountKeys[i]?.toBase58();
            if (!addr) continue;

            const balChange = (postBalances[i] ?? 0) - (preBalances[i] ?? 0);
            if (balChange > 0 && !cluster.includes(addr)) {
              cluster.push(addr);
            }
          }
        }
      }

      await this.cacheService.set(cacheKey, cluster, DEV_CLUSTER_CACHE_TTL);

      logger.info('ScamDetector: dev wallet cluster resolved', {
        devWallet: devWallet.slice(0, 8),
        fundingSource: fundingSource.slice(0, 8),
        clusterSize: cluster.length,
        rpcCallsUsed: rpcCalls,
      });

      return cluster;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ScamDetector: getDevWalletCluster failed', {
        devWallet: devWallet.slice(0, 8),
        error: errorMsg,
      });
      return [devWallet];
    }
  }

  async checkClusterBlacklist(devWallet: string): Promise<{
    blacklisted: boolean;
    recentTokenCreators: number;
    scorePenalty: number;
  }> {
    try {
      const cluster = await this.getDevWalletCluster(devWallet);

      for (const wallet of cluster) {
        if (this.knownScamWallets.has(wallet)) {
          logger.warn('ScamDetector: cluster wallet is blacklisted — immediate reject', {
            devWallet: devWallet.slice(0, 8),
            blacklistedWallet: wallet.slice(0, 8),
          });
          return { blacklisted: true, recentTokenCreators: 0, scorePenalty: 100 };
        }

        try {
          const key = CacheService.buildKey('scam_wallet', wallet);
          const cached = await this.cacheService.get(key);
          if (cached) {
            return { blacklisted: true, recentTokenCreators: 0, scorePenalty: 100 };
          }
        } catch { /* non-critical */ }
      }

      let recentTokenCreators = 0;
      const fortyEightHoursAgo = Date.now() - (48 * 60 * 60 * 1000);

      for (const wallet of cluster) {
        try {
          const key = CacheService.buildKey('token_creator', wallet);
          const cached = await this.cacheService.get<{ createdAt: number }>(key);
          if (cached && cached.createdAt > fortyEightHoursAgo) {
            recentTokenCreators++;
          }
        } catch { /* non-critical */ }
      }

      const scorePenalty = recentTokenCreators >= 2 ? 25 : 0;

      if (scorePenalty > 0) {
        logger.info('ScamDetector: cluster has multiple recent token creators', {
          devWallet: devWallet.slice(0, 8),
          recentTokenCreators,
          scorePenalty,
        });
      }

      return { blacklisted: false, recentTokenCreators, scorePenalty };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ScamDetector: checkClusterBlacklist failed', {
        devWallet: devWallet.slice(0, 8),
        error: errorMsg,
      });
      return { blacklisted: false, recentTokenCreators: 0, scorePenalty: 0 };
    }
  }
}
