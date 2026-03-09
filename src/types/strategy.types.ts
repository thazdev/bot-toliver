// UPDATED: SmartWalletProfile Sharpe fields + ExitSignal types - 2026-03-07
import type { TokenInfo } from './token.types.js';
import type { PoolInfo } from './pool.types.js';
import type { Position, EnhancedPosition } from './position.types.js';

export type StrategySignal = 'buy' | 'sell' | 'hold' | 'skip';
export type StrategyTier = 'conservative' | 'balanced' | 'aggressive';
export type EntryTriggerType = 'new_token_sniper' | 'pool_creation_sniper' | 'momentum_confirmation' | 'dip_reentry';
export type StopLossState = 'WATCHING' | 'SOFT_WARNING' | 'BREAK_EVEN_ACTIVE' | 'HARD_STOP' | 'EMERGENCY_EXIT';
export type MarketRegime = 'bull' | 'bear' | 'choppy' | 'congested';

export interface HolderData {
  holderCount: number;
  topHolderPercent: number;
  top5HolderPercent: number;
  top10HolderPercent?: number;
  holderGrowthRate: number;
  holdersDecreasing: boolean;
}

export interface VolumeContext {
  volume1min: number;
  volume5minAvg: number;
  buyTxLast60s: number;
  sellTxLast20: number;
  buyTxLast20: number;
  volumeStillActive: boolean;
  sellVolumeRatio: number;
  largestSellPercent: number;
  volumePrev60s: number;
  txnsPerMinute: number;
  uniqueWalletsPerVolume: number;
  avgTradeSize: number;
  tradeSizeStdDev: number;
  buyRatio: number;
  tradeTimeDistributionScore: number;
  selfTradingDetected: boolean;
  volumeDropPercent60s: number;
}

export interface SafetyData {
  mintAuthorityDisabled: boolean;
  freezeAuthorityAbsent: boolean;
  isBlacklisted: boolean;
  rugScore: number;
  devWalletSelling: boolean;
  mintAuthorityReEnabled: boolean;
  liquidityDropPercent60s: number;
  liquidityDropPercent10s: number;
  txFailureRate30s: number;
  freezeAuthority: string | null;
  mintAuthority: string | null;
  sellTxFailureRate: number;
  sellsFromSingleWallet: boolean;
  noSuccessfulSells10min: boolean;
  buyTaxPercent: number;
  sellTaxPercent: number;
  bundleDetected: boolean;
  honeypotSimulationPassed: boolean;
}

export type SmartMoneyTier = 'tier1' | 'tier2' | 'untracked';
export type WhaleSize = 'micro' | 'whale' | 'mega' | 'institutional';
export type SentimentRegime = 'euphoria' | 'healthy_bull' | 'neutral' | 'bearish' | 'panic';

export interface SmartMoneyData {
  smartMoneyHolding: boolean;
  smartMoneyScore: number;
  tier1WalletsBuying: number;
  tier2WalletsBuying: number;
  smartWalletSellingPercent: number;
  smartWalletFullExit: boolean;
}

export interface WhaleActivityData {
  whaleBuysLast5min: number;
  whaleDistinctBuyers5min: number;
  whaleSellsLast5min: number;
  whaleDistinctSellers5min: number;
  largestWhaleBuySol: number;
  whaleFirstBuyerSelling: boolean;
  whaleWashTradeDetected: boolean;
  whaleConfidenceScore: number;
  totalWhaleBuySol5min?: number;
}

export interface SentimentData {
  sentimentScore: number;
  sentimentRegime: SentimentRegime;
  newTokenRateVsAvg: number;
  avgPoolSizeVsAvg: number;
  rugRateToday: number;
  solTransferVolumeSpike: boolean;
  newWalletCreationRate: number;
  dexVsCexRatio: number;
  avgTxFee: number;
  failedTxRate: number;
}

export interface TokenSentimentData {
  holderCountVelocity: number;
  txFrequency: number;
  avgBuySizeTrend: number;
  sellSizeDistribution: 'small_retail' | 'large_whale' | 'mixed';
  returnBuyerRate: number;
}

export interface StrategyContext {
  tokenInfo: TokenInfo;
  poolInfo: PoolInfo;
  position?: Position;
  enhancedPosition?: EnhancedPosition;
  currentPrice: number;
  liquidity: number;
  liquidityUsd: number;
  volume: number;
  timestamp: number;

  tokenAgeSec: number;
  priceChangeFromLaunch: number;
  priceChangePercent5min: number;
  priceStdDev30min: number;

  holderData: HolderData;
  volumeContext: VolumeContext;
  safetyData: SafetyData;
  smartMoneyData: SmartMoneyData;
  whaleData: WhaleActivityData;
  sentimentData: SentimentData;
  tokenSentiment: TokenSentimentData;
  priceSamples: number[];

  previouslyTraded: boolean;
  priceDropFromPeak: number;

  poolInitialSol: number;
  marketRegime: MarketRegime;
  solPriceChange24h: number;

  price60sAgo: number;
  priceRising: boolean;
  uniqueBuyers5min: number;
  uniqueBuyers2min?: number;
  uniqueBuyers10min?: number;
  buySellRatio5min: number;
  liquidityStable: boolean;
  tokenSource: 'pumpfun' | 'raydium' | 'unknown';
  pumpfunMarketCap: number;
  pumpfunGraduated: boolean;
  pumpfunCreationRatePerHour: number;
  consecutiveLosses: number;
  dailyLossPercent: number;
  solanaTps: number;
  rpcErrorRate5min: number;
  gasMultiplier: number;
  hotWalletBalance: number;
  jupiterAvailable: boolean;
  websocketConnected: boolean;
  databaseHealthy: boolean;
  redisConnected: boolean;
  btcPriceChange1h: number;
  newTokensPerHour: number;
  winRateLast20: number;
  knownExploitActive: boolean;
  flashloanDetected: boolean;
}

export interface EntryScoreBreakdown {
  liquidityScore: number;
  holderScore: number;
  momentumScore: number;
  safetyScore: number;
  smartMoneyScore: number;
  totalScore: number;
}

export interface StrategyResult {
  signal: StrategySignal;
  confidence: number;
  reason: string;
  suggestedSizeSol: number;
  triggerType?: EntryTriggerType;
  entryScore?: EntryScoreBreakdown;
}

export interface ExitDecision {
  shouldExit: boolean;
  sellPercent: number;
  reason: string;
  isEmergency: boolean;
}

export interface StopLossStatus {
  state: StopLossState;
  currentStopPrice: number;
  trailingDelta: number;
  peakPrice: number;
}

export type LaunchPhase = 'birth' | 'ignition' | 'discovery' | 'momentum' | 'peak' | 'decline';

export type ProfitStage = 'tp1' | 'tp2' | 'tp3' | 'tp4_moonbag';

export interface MomentumSnapshot {
  momentumScore: number;
  priceVelocity: number;
  volumeAcceleration: number;
  txFrequency: number;
  timestamp: number;
}

export interface HoneypotCheckResult {
  passed: boolean;
  reason: string;
  buySimSuccess: boolean;
  sellSimSuccess: boolean;
  estimatedBuyTax: number;
  estimatedSellTax: number;
  freezeAuthorityRisk: boolean;
  mintAuthorityRisk: boolean;
  sellFailureRate: number;
}

export interface TradingGuardStatus {
  canTrade: boolean;
  hardBlock: boolean;
  softRestriction: boolean;
  reason: string;
  positionSizeMultiplier: number;
  entryScoreBoost: number;
}

export interface ProfitTakeState {
  stage1Executed: boolean;
  stage2Executed: boolean;
  stage3Executed: boolean;
  stage4Executed: boolean;
  totalSoldPercent: number;
  breakEvenStopActive: boolean;
  trailingStopActive: boolean;
}

export interface SmartWalletProfile {
  address: string;
  tier: SmartMoneyTier;
  smartScore: number;
  winRate: number;
  avgRoi: number;
  portfolioSol: number;
  totalTrades30d: number;
  earlyEntryRate: number;
  frequencyScore: number;
  lastScoreUpdate: number;
  blacklisted: boolean;
  roiStdDev?: number;
  maxSingleLoss?: number;
  sharpeScore?: number;
}

export interface WhaleTransaction {
  wallet: string;
  tokenMint: string;
  direction: 'buy' | 'sell';
  amountSol: number;
  size: WhaleSize;
  timestamp: number;
  isSmartMoney: boolean;
  smartScore: number;
}

export interface FilterPipelineResult {
  step: string;
  passed: boolean;
  reason: string;
  durationMs: number;
  scores?: Record<string, number>;
}

export interface TradeFilterOutcome {
  tokenMint: string;
  passed: boolean;
  steps: FilterPipelineResult[];
  totalDurationMs: number;
  finalEntryScore: number;
  rejectionReason?: string;
}

export interface StrategyFeedbackReport {
  period: string;
  winRate: number;
  avgRoi: number;
  avgHoldTimeMs: number;
  bestEntryScoreRange: [number, number];
  optimalRugScoreThreshold: number;
  topPredictiveSmartWallets: string[];
  parameterAdjustments: Record<string, { current: number; recommended: number }>;
}
