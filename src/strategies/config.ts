// UPDATED: Momentum decay thresholds + ScamRules wallet age - 2026-03-07
import type { StrategyTier } from '../types/strategy.types.js';

export interface EntryConfig {
  minLiquiditySol: number;
  minHolderCount: number;
  maxTopHolderPercent: number;
  maxTop5HolderPercent: number;
  minEntryScore: number;
  maxPositionPercent: number;
  solSizeMin: number;
  solSizeMax: number;
  slippageTolerancePercent: number;
  maxPriceGainFromLaunch: number;
  /** Mínimo de compras nos últimos 60s para passar no signal stack. Relaxado em FILTER_RELAX_FOR_DRY_RUN. */
  minBuyTxLast60s?: number;
}

export interface ExitConfig {
  tp1: { sellPercent: number; gainPercent: number };
  tp2: { sellPercent: number; gainPercent: number };
  tp3: { sellPercent: number; gainPercent: number };
  residualHoldPercent: number;
}

export interface StopLossConfig {
  hardStopPercent: number;
  softWarningPercent: number;
  breakEvenActivationGain: number;
  trailingStopDelta: number;
}

export interface SizingConfig {
  basePositionPercent: number;
  maxSinglePositionPercent: number;
  minPositionSol: number;
  maxConcurrentPositions: number;
  highConvictionMultiplier: number;
  lowConvictionMultiplier: number;
  highConvictionThreshold: number;
  lowConvictionMinScore: number;
}

export interface RiskConfig {
  maxDailyLossPercent: number;
  maxDrawdownPercent: number;
  maxWeeklyLossPercent: number;
  maxExposurePercent: number;
  emergencyHaltBalanceSol: number;
  maxSingleTokenExposurePercent: number;
  riskPerTradePercent: number;
  maxSlippageEntryPercent: number;
  maxSlippageExitPercent: number;
  gasReserveSol: number;
  sameTradeCooldownMs: number;
  reduceSizeAtRiskPercent: number;
  stopNewTradesAtRiskPercent: number;
  emergencyExitAtRiskPercent: number;
}

export interface CapitalConfig {
  hotWalletPercent: number;
  reservePercent: number;
  opportunityReservePercent: number;
  minHotWalletFloorPercent: number;
  maxDeployedPercent: number;
  maxPerTradePercent: number;
  maxPerDevWalletPercent: number;
  maxPerSectorPercent: number;
  minTradeSizeSol: number;
  compoundGrowthCap: number;
  opportunityScoreThreshold: number;
}

export interface LiquidityConfig {
  minPoolSol: number;
  minPoolUsd: number;
  maxImpactPercent: number;
  minLiquidityScore: number;
  minLiquidityAgeSec: number;
  impactMultiplier: number;
}

export interface HolderConfig {
  rejectBelowHolders: number;
  highRiskMaxHolders: number;
  highRiskSizeMultiplier: number;
  moderateMaxHolders: number;
  healthyMaxHolders: number;
  strongSignalMinHolders: number;
  viralVelocityThreshold: number;
  viralScoreBoost: number;
  strongLaunchVelocity: number;
  strongLaunchScoreBoost: number;
  staleVelocityThreshold: number;
  staleScorePenalty: number;
  sybilFundedPercentThreshold: number;
  topHolderRejectPercent: number;
  top5RejectPercent: number;
}

export interface MomentumConfig {
  strongMomentumVolTrend: number;
  moderateMomentumVolTrend: number;
  volumeCollapsingThreshold: number;
  absorptionVolTrend: number;
  strongMomentumScoreBoost: number;
  momentumDecayStage1: number;
  momentumDecayStage2: number;
  momentumDecayStage3: number;
  momentumDecaySell1Percent: number;
  momentumDecaySell2Percent: number;
}

export interface LaunchConfig {
  phase1MaxPortfolioPercent: number;
  phase1MinPoolSol: number;
  phase1MinRugScore: number;
  phase1Slippage: number;
  phase1StopPercent: number;
  phase1Tp1: { gainPercent: number; sellPercent: number };
  phase1Tp2: { gainPercent: number; sellPercent: number };
  phase1HoldPercent: number;
  phase2MinHolders: number;
  phase2MinUniqueBuyers: number;
  phase2MinBuySellRatio: number;
  phase2MaxPriceFromLaunch: number;
  phase2TrailingStop: number;
  pumpfunPreGradMaxMcap: number;
  pumpfunNearGradMinMcap: number;
  pumpfunGradMcap: number;
  pumpfunOverheatRate: number;
}

export interface HoneypotConfig {
  simBuyAmountSol: number;
  maxBuyTaxPercent: number;
  maxSellTaxPercent: number;
  rejectTaxPercent: number;
  maxSellFailureRate: number;
  knownSafePrograms: string[];
}

export interface ProfitTakingConfig {
  tp1: { gainPercent: number; sellPercent: number };
  tp2: { gainPercent: number; sellPercent: number };
  tp3: { gainPercent: number; sellPercent: number };
  tp4: { gainPercent: number };
  panicDropPercent: number;
  panicDropWindowSec: number;
  panicVolumeDropPercent: number;
  panicVolumeWindowSec: number;
  maxPoolImpactPercent: number;
}

export interface TrailingStopConfig {
  atrSampleCount: number;
  atrMultiplier: number;
  updateIntervalMs: number;
  spikeRecoveryWindowMs: number;
  spikeConfirmBreachMs: number;
  catastrophicDropPercent: number;
  phaseTrails: {
    breakEvenToGain30: number;
    gain30to75: number;
    gain75to150: number;
    gain150to300: number;
    gain300to500: number;
    gainAbove500: number;
  };
}

export interface SmartMoneyConfig {
  minWinRate: number;
  minAvgReturn: number;
  minPortfolioSol: number;
  minTrades30d: number;
  maxBuyTimingMinutes: number;
  tier1MinScore: number;
  tier2MinScore: number;
  scoreDecayPerWeek: number;
  autoDiscoveryMultiplier: number;
  autoDiscoveryMinTokens: number;
  copyTrade1WalletSizePct: number;
  copyTrade2WalletSizePct: number;
  copyTrade3WalletSizePct: number;
  followExitSellThresholdPct: number;
  followExitOurSellPct: number;
  followFullExitSellPct: number;
}

export interface WhaleConfig {
  microWhaleMinSol: number;
  microWhaleMaxSol: number;
  whaleMinSol: number;
  whaleMaxSol: number;
  megaWhaleMinSol: number;
  megaWhaleMaxSol: number;
  institutionalMinSol: number;
  multiTxWindowMinutes: number;
  multiTxMinBuys: number;
  buySignalMinSol: number;
  buySignalMaxTokenAgeMin: number;
  buyScoreBoost: number;
  multiWhaleBuyCount: number;
  multiWhaleSizeMultiplier: number;
  multiWhaleTpBoostPct: number;
  exitSingle20PctReducePct: number;
  exitSingle100PctSellPct: number;
  exit2WhalesSellPct: number;
  exit3WhalesSellPct: number;
  washTradeWindowSec: number;
}

export interface SentimentConfig {
  euphoriaMilestone: number;
  healthyBullMin: number;
  neutralMin: number;
  bearishMin: number;
  newTokenRateWeight: number;
  avgPoolSizeWeight: number;
  whaleBuyRateWeight: number;
  rugRateWeight: number;
  profitTakeRateWeight: number;
  solTransferSpikeMultiplier: number;
  failedTxRateMax: number;
}

export interface FilterConfig {
  deferTokenAgeSec: number;
  deferRecheckSec: number;
  minRugScoreStep3: number;
  minEntryScoreThreshold: number;
  smartMoneyOverrideMinWallets: number;
  extremeRugScoreOverride: number;
  extremeRugScoreBonus: number;
  euphoriaOverrideScore: number;
  feedbackAutoAdjustMaxPct: number;
  feedbackMinSampleSize: number;
}

export interface TierConfig {
  entry: EntryConfig;
  exit: ExitConfig;
  stopLoss: StopLossConfig;
  sizing: SizingConfig;
  risk: RiskConfig;
  capital: CapitalConfig;
  liquidity: LiquidityConfig;
  holder: HolderConfig;
  momentum: MomentumConfig;
  launch: LaunchConfig;
  honeypot: HoneypotConfig;
  profitTaking: ProfitTakingConfig;
  trailingStop: TrailingStopConfig;
  smartMoney: SmartMoneyConfig;
  whale: WhaleConfig;
  sentiment: SentimentConfig;
  filter: FilterConfig;
}

const SHARED_CAPITAL: CapitalConfig = {
  hotWalletPercent: 60,
  reservePercent: 25,
  opportunityReservePercent: 15,
  minHotWalletFloorPercent: 40,
  maxDeployedPercent: 20,
  maxPerTradePercent: 3,
  maxPerDevWalletPercent: 5,
  maxPerSectorPercent: 8,
  minTradeSizeSol: 0.05,
  compoundGrowthCap: 1.0,
  opportunityScoreThreshold: 90,
};

const SHARED_MOMENTUM: MomentumConfig = {
  strongMomentumVolTrend: 3.0,
  moderateMomentumVolTrend: 1.5,
  volumeCollapsingThreshold: 0.5,
  absorptionVolTrend: 3.0,
  strongMomentumScoreBoost: 15,
  momentumDecayStage1: parseFloat(process.env.MOMENTUM_DECAY_STAGE1 ?? '-0.25'),
  momentumDecayStage2: parseFloat(process.env.MOMENTUM_DECAY_STAGE2 ?? '-0.40'),
  momentumDecayStage3: parseFloat(process.env.MOMENTUM_DECAY_STAGE3 ?? '-0.60'),
  momentumDecaySell1Percent: 33,
  momentumDecaySell2Percent: 50,
};

const SHARED_LAUNCH: LaunchConfig = {
  phase1MaxPortfolioPercent: 0.5,
  phase1MinPoolSol: 3,
  phase1MinRugScore: 65,
  phase1Slippage: 10,
  phase1StopPercent: 20,
  phase1Tp1: { gainPercent: 75, sellPercent: 40 },
  phase1Tp2: { gainPercent: 200, sellPercent: 40 },
  phase1HoldPercent: 20,
  phase2MinHolders: 20,
  phase2MinUniqueBuyers: 15,
  phase2MinBuySellRatio: 0.55,
  phase2MaxPriceFromLaunch: 500,
  phase2TrailingStop: 12,
  pumpfunPreGradMaxMcap: 30_000,
  pumpfunNearGradMinMcap: 50_000,
  pumpfunGradMcap: 69_000,
  pumpfunOverheatRate: 100,
};

const SHARED_HONEYPOT: HoneypotConfig = {
  simBuyAmountSol: 0.01,
  maxBuyTaxPercent: 5,
  maxSellTaxPercent: 5,
  rejectTaxPercent: 15,
  maxSellFailureRate: 20,
  knownSafePrograms: [],
};

const SHARED_SMART_MONEY: SmartMoneyConfig = {
  minWinRate: 60,
  minAvgReturn: 100,
  minPortfolioSol: 5,
  minTrades30d: 20,
  maxBuyTimingMinutes: 10,
  tier1MinScore: 70,
  tier2MinScore: 50,
  scoreDecayPerWeek: 5,
  autoDiscoveryMultiplier: 3,
  autoDiscoveryMinTokens: 3,
  copyTrade1WalletSizePct: 50,
  copyTrade2WalletSizePct: 100,
  copyTrade3WalletSizePct: 150,
  followExitSellThresholdPct: 30,
  followExitOurSellPct: 50,
  followFullExitSellPct: 100,
};

const SHARED_WHALE: WhaleConfig = {
  microWhaleMinSol: 0.5,
  microWhaleMaxSol: 2,
  whaleMinSol: 2,
  whaleMaxSol: 10,
  megaWhaleMinSol: 10,
  megaWhaleMaxSol: 50,
  institutionalMinSol: 50,
  multiTxWindowMinutes: 10,
  multiTxMinBuys: 5,
  buySignalMinSol: 2,
  buySignalMaxTokenAgeMin: 30,
  buyScoreBoost: 20,
  multiWhaleBuyCount: 3,
  multiWhaleSizeMultiplier: 1.5,
  multiWhaleTpBoostPct: 50,
  exitSingle20PctReducePct: 25,
  exitSingle100PctSellPct: 50,
  exit2WhalesSellPct: 75,
  exit3WhalesSellPct: 100,
  washTradeWindowSec: 60,
};

const SHARED_SENTIMENT: SentimentConfig = {
  euphoriaMilestone: 80,
  healthyBullMin: 60,
  neutralMin: 40,
  bearishMin: 20,
  newTokenRateWeight: 0.20,
  avgPoolSizeWeight: 0.20,
  whaleBuyRateWeight: 0.25,
  rugRateWeight: 0.20,
  profitTakeRateWeight: 0.15,
  solTransferSpikeMultiplier: 2.0,
  failedTxRateMax: 15,
};

const SHARED_FILTER: FilterConfig = {
  deferTokenAgeSec: 10,
  deferRecheckSec: 30,
  minRugScoreStep3: 50,
  minEntryScoreThreshold: 60,
  smartMoneyOverrideMinWallets: 3,
  extremeRugScoreOverride: 95,
  extremeRugScoreBonus: 5,
  euphoriaOverrideScore: 85,
  feedbackAutoAdjustMaxPct: 10,
  feedbackMinSampleSize: 100,
};

const SHARED_HOLDER: HolderConfig = {
  rejectBelowHolders: 10,
  highRiskMaxHolders: 50,
  highRiskSizeMultiplier: 0.5,
  moderateMaxHolders: 200,
  healthyMaxHolders: 1000,
  strongSignalMinHolders: 1000,
  viralVelocityThreshold: 50,
  viralScoreBoost: 20,
  strongLaunchVelocity: 10,
  strongLaunchScoreBoost: 10,
  staleVelocityThreshold: 1,
  staleScorePenalty: 15,
  sybilFundedPercentThreshold: 80,
  topHolderRejectPercent: 30,
  top5RejectPercent: 60,
};

const CONSERVATIVE: TierConfig = {
  entry: {
    minLiquiditySol: 5,
    minHolderCount: 10,
    maxTopHolderPercent: 20,
    maxTop5HolderPercent: 40,
    minEntryScore: 75,
    maxPositionPercent: 1,
    solSizeMin: 0.05,
    solSizeMax: 0.2,
    slippageTolerancePercent: 3,
    maxPriceGainFromLaunch: 300,
  },
  exit: {
    tp1: { sellPercent: 30, gainPercent: 50 },
    tp2: { sellPercent: 40, gainPercent: 100 },
    tp3: { sellPercent: 100, gainPercent: 150 },
    residualHoldPercent: 0,
  },
  stopLoss: {
    hardStopPercent: 15,
    softWarningPercent: 8,
    breakEvenActivationGain: 30,
    trailingStopDelta: 8,
  },
  sizing: {
    basePositionPercent: 1,
    maxSinglePositionPercent: 3,
    minPositionSol: 0.05,
    maxConcurrentPositions: 5,
    highConvictionMultiplier: 1.5,
    lowConvictionMultiplier: 0.5,
    highConvictionThreshold: 85,
    lowConvictionMinScore: 45,
  },
  risk: {
    maxDailyLossPercent: 5,
    maxDrawdownPercent: 15,
    maxWeeklyLossPercent: 20,
    maxExposurePercent: 10,
    emergencyHaltBalanceSol: 0.5,
    maxSingleTokenExposurePercent: 3,
    riskPerTradePercent: 0.5,
    maxSlippageEntryPercent: 15,
    maxSlippageExitPercent: 20,
    gasReserveSol: 0.05,
    sameTradeCooldownMs: 30 * 60 * 1000,
    reduceSizeAtRiskPercent: 3,
    stopNewTradesAtRiskPercent: 5,
    emergencyExitAtRiskPercent: 8,
  },
  capital: SHARED_CAPITAL,
  liquidity: {
    minPoolSol: 5,
    minPoolUsd: 500,
    maxImpactPercent: 3,
    minLiquidityScore: 60,
    minLiquidityAgeSec: 300,
    impactMultiplier: 1.5,
  },
  holder: SHARED_HOLDER,
  momentum: SHARED_MOMENTUM,
  launch: SHARED_LAUNCH,
  honeypot: SHARED_HONEYPOT,
  profitTaking: {
    tp1: { gainPercent: 50, sellPercent: 30 },
    tp2: { gainPercent: 100, sellPercent: 40 },
    tp3: { gainPercent: 150, sellPercent: 100 },
    tp4: { gainPercent: 500 },
    panicDropPercent: 20,
    panicDropWindowSec: 30,
    panicVolumeDropPercent: 80,
    panicVolumeWindowSec: 60,
    maxPoolImpactPercent: 5,
  },
  trailingStop: {
    atrSampleCount: 10,
    atrMultiplier: 2.0,
    updateIntervalMs: 5000,
    spikeRecoveryWindowMs: 10_000,
    spikeConfirmBreachMs: 8_000,
    catastrophicDropPercent: 30,
    phaseTrails: {
      breakEvenToGain30: 0,
      gain30to75: 15,
      gain75to150: 12,
      gain150to300: 10,
      gain300to500: 8,
      gainAbove500: 6,
    },
  },
  smartMoney: SHARED_SMART_MONEY,
  whale: SHARED_WHALE,
  sentiment: SHARED_SENTIMENT,
  filter: { ...SHARED_FILTER, minEntryScoreThreshold: 75 },
};

const BALANCED: TierConfig = {
  entry: {
    minLiquiditySol: 3,
    minHolderCount: 5,
    maxTopHolderPercent: 20,
    maxTop5HolderPercent: 40,
    minEntryScore: 60,
    maxPositionPercent: 2,
    solSizeMin: 0.1,
    solSizeMax: 0.5,
    slippageTolerancePercent: 7,
    maxPriceGainFromLaunch: 500,
  },
  exit: {
    tp1: { sellPercent: 25, gainPercent: 75 },
    tp2: { sellPercent: 35, gainPercent: 150 },
    tp3: { sellPercent: 100, gainPercent: 300 },
    residualHoldPercent: 5,
  },
  stopLoss: {
    hardStopPercent: 20,
    softWarningPercent: 10,
    breakEvenActivationGain: 50,
    trailingStopDelta: 12,
  },
  sizing: {
    basePositionPercent: 1,
    maxSinglePositionPercent: 3,
    minPositionSol: 0.05,
    maxConcurrentPositions: 5,
    highConvictionMultiplier: 1.5,
    lowConvictionMultiplier: 0.5,
    highConvictionThreshold: 85,
    lowConvictionMinScore: 45,
  },
  risk: {
    maxDailyLossPercent: 8,
    maxDrawdownPercent: 15,
    maxWeeklyLossPercent: 20,
    maxExposurePercent: 20,
    emergencyHaltBalanceSol: 0.5,
    maxSingleTokenExposurePercent: 3,
    riskPerTradePercent: 0.5,
    maxSlippageEntryPercent: 15,
    maxSlippageExitPercent: 20,
    gasReserveSol: 0.05,
    sameTradeCooldownMs: 30 * 60 * 1000,
    reduceSizeAtRiskPercent: 3,
    stopNewTradesAtRiskPercent: 5,
    emergencyExitAtRiskPercent: 8,
  },
  capital: SHARED_CAPITAL,
  liquidity: {
    minPoolSol: 3,
    minPoolUsd: 300,
    maxImpactPercent: 5,
    minLiquidityScore: 45,
    minLiquidityAgeSec: 120,
    impactMultiplier: 1.5,
  },
  holder: SHARED_HOLDER,
  momentum: SHARED_MOMENTUM,
  launch: SHARED_LAUNCH,
  honeypot: SHARED_HONEYPOT,
  profitTaking: {
    tp1: { gainPercent: 75, sellPercent: 25 },
    tp2: { gainPercent: 150, sellPercent: 35 },
    tp3: { gainPercent: 250, sellPercent: 100 },
    tp4: { gainPercent: 500 },
    panicDropPercent: 20,
    panicDropWindowSec: 30,
    panicVolumeDropPercent: 80,
    panicVolumeWindowSec: 60,
    maxPoolImpactPercent: 5,
  },
  trailingStop: {
    atrSampleCount: 10,
    atrMultiplier: 2.5,
    updateIntervalMs: 5000,
    spikeRecoveryWindowMs: 10_000,
    spikeConfirmBreachMs: 8_000,
    catastrophicDropPercent: 30,
    phaseTrails: {
      breakEvenToGain30: 0,
      gain30to75: 15,
      gain75to150: 12,
      gain150to300: 10,
      gain300to500: 8,
      gainAbove500: 6,
    },
  },
  smartMoney: SHARED_SMART_MONEY,
  whale: SHARED_WHALE,
  sentiment: SHARED_SENTIMENT,
  filter: { ...SHARED_FILTER, minEntryScoreThreshold: 60 },
};

const AGGRESSIVE: TierConfig = {
  entry: {
    minLiquiditySol: 1,
    minHolderCount: 3,
    maxTopHolderPercent: 20,
    maxTop5HolderPercent: 40,
    minEntryScore: 45,
    maxPositionPercent: 3,
    solSizeMin: 0.2,
    solSizeMax: 1.0,
    slippageTolerancePercent: 15,
    maxPriceGainFromLaunch: 1000,
  },
  exit: {
    tp1: { sellPercent: 20, gainPercent: 100 },
    tp2: { sellPercent: 30, gainPercent: 200 },
    tp3: { sellPercent: 100, gainPercent: 500 },
    residualHoldPercent: 10,
  },
  stopLoss: {
    hardStopPercent: 25,
    softWarningPercent: 15,
    breakEvenActivationGain: 75,
    trailingStopDelta: 18,
  },
  sizing: {
    basePositionPercent: 1,
    maxSinglePositionPercent: 3,
    minPositionSol: 0.05,
    maxConcurrentPositions: 5,
    highConvictionMultiplier: 1.5,
    lowConvictionMultiplier: 0.5,
    highConvictionThreshold: 85,
    lowConvictionMinScore: 45,
  },
  risk: {
    maxDailyLossPercent: 12,
    maxDrawdownPercent: 15,
    maxWeeklyLossPercent: 20,
    maxExposurePercent: 20,
    emergencyHaltBalanceSol: 0.5,
    maxSingleTokenExposurePercent: 3,
    riskPerTradePercent: 0.5,
    maxSlippageEntryPercent: 15,
    maxSlippageExitPercent: 20,
    gasReserveSol: 0.05,
    sameTradeCooldownMs: 30 * 60 * 1000,
    reduceSizeAtRiskPercent: 3,
    stopNewTradesAtRiskPercent: 5,
    emergencyExitAtRiskPercent: 8,
  },
  capital: SHARED_CAPITAL,
  liquidity: {
    minPoolSol: 1,
    minPoolUsd: 100,
    maxImpactPercent: 8,
    minLiquidityScore: 30,
    minLiquidityAgeSec: 30,
    impactMultiplier: 1.5,
  },
  holder: SHARED_HOLDER,
  momentum: SHARED_MOMENTUM,
  launch: SHARED_LAUNCH,
  honeypot: SHARED_HONEYPOT,
  profitTaking: {
    tp1: { gainPercent: 100, sellPercent: 20 },
    tp2: { gainPercent: 250, sellPercent: 30 },
    tp3: { gainPercent: 500, sellPercent: 70 },
    tp4: { gainPercent: 1000 },
    panicDropPercent: 20,
    panicDropWindowSec: 30,
    panicVolumeDropPercent: 80,
    panicVolumeWindowSec: 60,
    maxPoolImpactPercent: 5,
  },
  trailingStop: {
    atrSampleCount: 10,
    atrMultiplier: 3.0,
    updateIntervalMs: 5000,
    spikeRecoveryWindowMs: 10_000,
    spikeConfirmBreachMs: 8_000,
    catastrophicDropPercent: 30,
    phaseTrails: {
      breakEvenToGain30: 0,
      gain30to75: 15,
      gain75to150: 12,
      gain150to300: 10,
      gain300to500: 8,
      gainAbove500: 6,
    },
  },
  smartMoney: SHARED_SMART_MONEY,
  whale: SHARED_WHALE,
  sentiment: SHARED_SENTIMENT,
  filter: { ...SHARED_FILTER, minEntryScoreThreshold: 45 },
};

const TIER_CONFIGS: Record<StrategyTier, TierConfig> = {
  conservative: CONSERVATIVE,
  balanced: BALANCED,
  aggressive: AGGRESSIVE,
};

const isDryRun = (): boolean =>
  (process.env.BOT_DRY_RUN ?? process.env.DRY_RUN ?? 'true') !== 'false';

export const shouldRelaxFiltersForDryRun = (): boolean =>
  process.env.FILTER_RELAX_FOR_DRY_RUN === 'true' && isDryRun();

export function getTierConfig(tier: StrategyTier): TierConfig {
  const base = TIER_CONFIGS[tier];
  if (!shouldRelaxFiltersForDryRun()) return base;

  // Modo de teste: relaxa filtros para permitir simulações em dry run.
  // Ative com FILTER_RELAX_FOR_DRY_RUN=true no .env
  return {
    ...base,
    entry: {
      ...base.entry,
      minLiquiditySol: Math.min(base.entry.minLiquiditySol, 0.5),
      minHolderCount: 0,
      minEntryScore: Math.min(base.entry.minEntryScore, 15),
      maxTopHolderPercent: Math.max(base.entry.maxTopHolderPercent, 100),
      maxTop5HolderPercent: Math.max(base.entry.maxTop5HolderPercent, 100),
      minBuyTxLast60s: 0,
    },
    filter: {
      ...base.filter,
      deferTokenAgeSec: 3,
      minRugScoreStep3: 40,
      minEntryScoreThreshold: 15,
      feedbackMinSampleSize: 1,
    },
  };
}

export const TIME_EXIT_RULES = {
  breakEvenAfterMs: 10 * 60 * 1000,
  breakEvenFloorPercent: 5,
  sell25AfterMs: 30 * 60 * 1000,
  sell25Percent: 25,
  sell50AfterMs: 60 * 60 * 1000,
  sell50Percent: 50,
  exitAllAfterMs: 2 * 60 * 60 * 1000,
  emergencyExitAfterMs: 4 * 60 * 60 * 1000,
} as const;

export const VOLUME_EXIT_RULES = {
  volumeCollapseThreshold: 0.3,
  sellVolumeRatioThreshold: 0.65,
  sellVolumeRatioSellPercent: 75,
  largeSellThresholdPercent: 1,
} as const;

export const LIQUIDITY_EXIT_RULES = {
  drop10In60sSellPercent: 50,
  drop10In60sThreshold: 10,
  drop20In60sSellPercent: 100,
  drop20In60sThreshold: 20,
  drop5In10sSellPercent: 100,
  drop5In10sThreshold: 5,
} as const;

export const CONSECUTIVE_LOSS_RULES = {
  reduceTo50AtLosses: 3,
  reduceTo25AtLosses: 4,
  pauseAtLosses: 5,
  pauseDurationMs: 60 * 60 * 1000,
  recoverTo75AfterWins: 2,
  fullRecoverAfterWins: 4,
} as const;

export const RUG_SCORE_RULES = {
  mintAuthorityBurned: 20,
  freezeAuthorityAbsent: 15,
  lpTokensBurned: 20,
  lpTokensLocked6m: 15,
  lpNotLockedPenalty: -30,
  devHoldsOver10Percent: -20,
  contractVerified: 10,
  tokenTooYoung: -10,
  tokenTooYoungAgeSec: 120,
  poolAbove10Sol: 10,
  poolBelow2Sol: -15,
  devRugHistoryPenalty: -50,
  safeThreshold: 70,
  elevatedRiskMin: 50,
  elevatedRiskSizeMultiplier: 0.5,
  elevatedRiskStopPercent: 10,
  rejectThreshold: 50,
  baseScore: 50,
} as const;

export const SCAM_RULES = {
  walletAgeRejectHours: 0,
  walletAgePenaltyHours: parseInt(process.env.SCAM_WALLET_AGE_PENALTY_HOURS ?? '24', 10),
  walletAgePenaltyAmount: parseInt(process.env.SCAM_WALLET_AGE_PENALTY_AMOUNT ?? '20', 10),
  walletAgeReduceScoreDays: 7,
  walletAgeReduceScoreAmount: 15,
  maxTokensIn7Days: 3,
  zeroPriorTxReject: true,
  scamDbCacheTtlSeconds: 6 * 60 * 60,
  bundleLaunchWalletThreshold: 10,
  copycatSimilarityThreshold: 0.85,
} as const;

export const RUG_MONITOR_INTERVAL_MS = 5000;

export const TRADING_GUARD_RULES = {
  hardBlock: {
    maxDailyLossPercent: 5,
    maxConsecutiveLosses: 5,
    minSolanaTps: 1000,
    maxRpcErrorRate: 10,
    maxGasMultiplier: 5,
    minHotWalletSol: 0.1,
    maxWebsocketDisconnectSec: 30,
  },
  softRestriction: {
    solanaDownPercent1h: 5,
    btcDownPercent1h: 3,
    noisyMarketTokensPerHour: 500,
    consecutiveSmallLosses: 3,
    minWinRateLast20: 25,
    pauseHoursOnLowWinRate: 4,
    softSizeMultiplier: 0.5,
    softScoreBoost: 10,
  },
  tokenBlacklist: {
    minRugScore: 50,
    stoppedOutCooldownMs: 24 * 60 * 60 * 1000,
  },
} as const;

export const VOLUME_ANOMALY_RULES = {
  minUniqueWalletsPerVolUnit: 3,
  volumeUnitSol: 10,
  tradeSizeVarianceMin: 0.1,
  minBuyRatio: 0.30,
  maxBuyRatio: 0.90,
  selfTradeWindowSec: 10,
} as const;

export const LAUNCH_PHASE_RULES = {
  birthMaxSec: 60,
  ignitionMaxSec: 300,
  discoveryMaxSec: 900,
  momentumMaxSec: 3600,
  peakMaxSec: 7200,
} as const;
