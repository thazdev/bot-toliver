import type { Connection } from '@solana/web3.js';
import { loadConfig } from './config/index.js';
import { loadQueueConfig } from './config/queue.config.js';
import { logger } from './utils/logger.js';
import { BOT_VERSION } from './utils/constants.js';

import { DatabaseClient } from './core/database/DatabaseClient.js';
import { MigrationRunner } from './core/database/MigrationRunner.js';
import { RedisClient } from './core/cache/RedisClient.js';
import { ConnectionManager } from './core/connection/ConnectionManager.js';
import { WebSocketManager } from './core/websocket/WebSocketManager.js';
import { QueueManager } from './core/queue/QueueManager.js';
import { WorkerManager } from './core/queue/WorkerManager.js';
import { QueueName } from './types/queue.types.js';
import type { TokenScanJobPayload, TradeExecuteJobPayload, PositionMonitorJobPayload, AlertJobPayload } from './types/queue.types.js';

import { LogsListener } from './listeners/LogsListener.js';
import { ProgramAccountListener } from './listeners/ProgramAccountListener.js';
import { TokenMintListener } from './listeners/TokenMintListener.js';
import { RaydiumPoolListener } from './listeners/RaydiumPoolListener.js';
import { PumpFunListener } from './listeners/PumpFunListener.js';
import { LiquidityListener } from './listeners/LiquidityListener.js';
import { LargeTransactionListener } from './listeners/LargeTransactionListener.js';
import { PollingFallbackListener } from './listeners/PollingFallbackListener.js';
import type { BaseListener } from './listeners/BaseListener.js';

import { RaydiumClient } from './dex/raydium/RaydiumClient.js';
import { PumpFunClient } from './dex/pumpfun/PumpFunClient.js';
import { PoolScanner } from './scanners/PoolScanner.js';
import { TokenScanner } from './scanners/TokenScanner.js';

import { TradeExecutor } from './execution/TradeExecutor.js';
import { PositionManager } from './positions/PositionManager.js';
import { PositionTracker } from './positions/PositionTracker.js';
import { PriceMonitor } from './monitoring/PriceMonitor.js';
import { BotHealthMonitor } from './monitoring/BotHealthMonitor.js';

import { ExposureTracker } from './risk/ExposureTracker.js';
import { CircuitBreaker } from './risk/CircuitBreaker.js';
import { RiskManager } from './risk/RiskManager.js';
import { CapitalManager } from './capital/CapitalManager.js';

import { StrategyRegistry } from './strategies/StrategyRegistry.js';
import { EntryStrategy } from './strategies/EntryStrategy.js';
import { MomentumStrategy } from './strategies/MomentumStrategy.js';
import { LaunchStrategy } from './strategies/LaunchStrategy.js';
import { ExitManager } from './strategies/ExitManager.js';
import { StopLossManager } from './strategies/StopLossManager.js';
import { MultiStageProfitTaker } from './strategies/MultiStageProfitTaker.js';
import { getTierConfig, shouldRelaxFiltersForDryRun } from './strategies/config.js';
import { getEffectiveDryRun } from './config/DryRunResolver.js';
import { isBotEnabled, isBotEnabledNoCache } from './config/BotEnabledResolver.js';
import { setConnectionsPaused } from './config/ConnectionsPausedResolver.js';
import { AlertService } from './alerts/AlertService.js';
import { StatsTracker } from './stats/StatsTracker.js';
import { StatsSnapshot } from './stats/StatsSnapshot.js';
import { PositionSizer } from './capital/PositionSizer.js';
import { RugDetector } from './analysis/RugDetector.js';
import { ScamDetector } from './analysis/ScamDetector.js';
import { LiquidityAnalyzer } from './analysis/LiquidityAnalyzer.js';
import { HolderAnalyzer } from './analysis/HolderAnalyzer.js';
import { HolderVolumeFetcher } from './services/HolderVolumeFetcher.js';
import { HoneypotChecker } from './analysis/HoneypotChecker.js';
import { SmartMoneyTracker } from './analysis/SmartMoneyTracker.js';
import { WhaleMonitor } from './analysis/WhaleMonitor.js';
import { MarketSentiment } from './analysis/MarketSentiment.js';
import { TradingGuard } from './risk/TradingGuard.js';
import { TrailingStopStrategy } from './strategies/TrailingStopStrategy.js';
import { TradeFilterPipeline } from './strategies/TradeFilterPipeline.js';
import { ExitDecisionEngine } from './trading/ExitDecisionEngine.js';
import { TransactionManager } from './trading/TransactionManager.js';
import { StateReconciler } from './trading/StateReconciler.js';
import type { EnhancedPosition, ExitTranche } from './types/position.types.js';
import type {
  StrategyContext, HolderData, VolumeContext, SafetyData, SmartMoneyData,
  WhaleActivityData, SentimentData, TokenSentimentData,
} from './types/strategy.types.js';

let listeners: BaseListener[] = [];
let queueManager: QueueManager;
let workerManager: WorkerManager;
let webSocketManager: WebSocketManager;
let connectionManager: ConnectionManager;
let statsSnapshot: StatsSnapshot;
let botHealthMonitor: BotHealthMonitor;
let tradingGuard: TradingGuard;
let connectionsPaused = false;
let botEnabledWatcherInterval: ReturnType<typeof setInterval> | null = null;
let diagnosticsInterval: ReturnType<typeof setInterval> | null = null;

/** PASSO 3: Teste de conectividade WebSocket isolado — escuta QUALQUER log na rede por 30s */
async function testWebSocket(connection: Connection): Promise<void> {
  logger.info('WS_TEST: Starting WebSocket connectivity test...');

  let receivedAny = false;

  const subId = connection.onLogs(
    'all' as never,
    (logs: { signature: string; logs?: string[] }) => {
      if (!receivedAny) {
        receivedAny = true;
        logger.info('WS_TEST: WebSocket is working — first log received', {
          signature: logs.signature,
          program: logs.logs?.[0]?.substring(0, 50),
        });
      }
    },
    'processed',
  );

  await new Promise((resolve) => setTimeout(resolve, 30_000));
  await connection.removeOnLogsListener(subId);

  if (!receivedAny) {
    logger.error('WS_TEST FAILED: No logs received in 30 seconds — WebSocket not working');
    logger.error('Check: HELIUS_WS_URL is set correctly in .env');
    logger.error('Check: The URL starts with wss:// not https://');
  } else {
    logger.info('WS_TEST PASSED: WebSocket connectivity confirmed');
  }
}

async function main(): Promise<void> {
  (globalThis as { __botStartTime?: number }).__botStartTime = Date.now();
  logger.info(`Solana Trading Bot v${BOT_VERSION} starting...`);

  const config = loadConfig();
  logger.info('Configuration loaded', { dryRun: config.bot.dryRun, logLevel: config.bot.logLevel });

  // PASSO 4: Verificação de variáveis de ambiente no boot
  logger.info('ENV_CHECK', {
    helius_rpc_set: !!process.env.HELIUS_RPC_URL,
    helius_ws_set: !!process.env.HELIUS_WS_URL,
    helius_ws_starts_with_wss: process.env.HELIUS_WS_URL?.startsWith('wss://'),
    wallet_set: !!process.env.WALLET_PRIVATE_KEY,
    dry_run: process.env.DRY_RUN,
    strategy_tier: process.env.STRATEGY_TIER,
    redis_connected: false,
    mysql_connected: false,
  });
  if (shouldRelaxFiltersForDryRun()) {
    logger.warn('FILTER_RELAX_FOR_DRY_RUN ativo — filtros relaxados para permitir simulações em dry run');
  }
  if ((process.env.FORCE_VALIDATION_SIMULATION === 'true' || process.env.VALIDATION_SIMULATION === 'true') && config.bot.dryRun) {
    logger.info('FORCE_VALIDATION_SIMULATION ativo — 1 simulação forçada a cada 5 min quando token passar no filtro');
  }

  DatabaseClient.initialize(config.database);
  const db = DatabaseClient.getInstance();
  await db.testConnection();

  const migrationRunner = new MigrationRunner();
  await migrationRunner.run();

  RedisClient.initialize(config.redis);

  connectionManager = ConnectionManager.initialize(config.solana, config.rateLimit);
  connectionManager.startHealthCheck();

  webSocketManager = new WebSocketManager(config.solana.heliusWsUrl);
  await webSocketManager.connect();

  const queueConfig = loadQueueConfig(config.redis);
  queueManager = new QueueManager(queueConfig);
  await queueManager.initialize();

  logger.info('ENV_CHECK', {
    redis_connected: true,
    mysql_connected: true,
  });

  workerManager = new WorkerManager(queueConfig);

  const raydiumClient = new RaydiumClient();
  const pumpFunClient = new PumpFunClient();
  // PumpFun primeiro — maioria dos tokens novos é Pump.fun; evita Raydium desnecessário
  const poolScanner = new PoolScanner([pumpFunClient, raydiumClient]);
  const tokenScanner = new TokenScanner(poolScanner);

  const priceMonitor = new PriceMonitor();
  const positionManager = new PositionManager(config);
  await positionManager.loadFromDatabase();

  const exposureTracker = new ExposureTracker(config);
  const openPositions = positionManager.getOpenPositions();
  const totalExposure = openPositions.reduce((sum, p) => sum + p.amountSol, 0);
  exposureTracker.setExposure(totalExposure);

  const circuitBreaker = new CircuitBreaker(config, queueManager);
  const riskManager = new RiskManager(circuitBreaker, exposureTracker, positionManager, config);
  const capitalManager = new CapitalManager(config);
  const positionSizer = new PositionSizer(config, exposureTracker);

  tradingGuard = new TradingGuard();
  const transactionManager = new TransactionManager(
    config,
    (tokenMint: string) => tradingGuard.recordTokenFailure(tokenMint),
  );
  const tradeExecutor = new TradeExecutor(config, queueManager, transactionManager);

  const positionTracker = new PositionTracker(positionManager, priceMonitor, queueManager, config);
  const strategyRegistry = new StrategyRegistry();
  const alertService = new AlertService(config);
  const statsTracker = new StatsTracker();

  const tier = config.trading.strategyTier;
  const entryStrategy = new EntryStrategy(tier);
  const momentumStrategy = new MomentumStrategy(tier);
  const launchStrategy = new LaunchStrategy(tier);
  strategyRegistry.register(entryStrategy);
  strategyRegistry.register(momentumStrategy);
  strategyRegistry.register(launchStrategy);

  const exitManager = new ExitManager(tier);
  const stopLossManager = new StopLossManager(tier);
  const multiStageProfitTaker = new MultiStageProfitTaker(tier);

  const rugDetector = new RugDetector();
  const scamDetector = new ScamDetector();
  const liquidityAnalyzer = new LiquidityAnalyzer(tier);
  const holderAnalyzer = new HolderAnalyzer(tier);
  const holderVolumeFetcher = new HolderVolumeFetcher(config.solana.heliusRpcUrl);
  const honeypotChecker = new HoneypotChecker(tier);
  const smartMoneyTracker = new SmartMoneyTracker(tier);
  const whaleMonitor = new WhaleMonitor(tier);
  const marketSentiment = new MarketSentiment(tier);
  const trailingStopStrategy = new TrailingStopStrategy(tier);
  const tradeFilterPipeline = new TradeFilterPipeline(tier);
  const exitDecisionEngine = new ExitDecisionEngine(tradeExecutor, queueManager);

  smartMoneyTracker.recalculateAllScores();

  // State reconciliation — before any new trades
  const stateReconciler = new StateReconciler();
  const reconciliation = await stateReconciler.reconcile();

  // Check for stuck positions from previous runs
  const stuckPositionKeys = await TransactionManager.getStuckPositionKeys();
  if (stuckPositionKeys.length > 0) {
    logger.error('CRITICAL: Found stuck positions from previous run — human intervention required', {
      count: stuckPositionKeys.length,
      keys: stuckPositionKeys,
    });
  }

  // Health monitor
  botHealthMonitor = BotHealthMonitor.initialize(tradingGuard);
  botHealthMonitor.start();

  logger.info('Strategies and analyzers initialized', {
    tier,
    strategies: [entryStrategy.name, momentumStrategy.name, launchStrategy.name],
    modules: [
      'ExitManager', 'StopLossManager', 'MultiStageProfitTaker', 'TrailingStopStrategy',
      'RugDetector', 'ScamDetector', 'LiquidityAnalyzer', 'HolderAnalyzer',
      'HoneypotChecker', 'SmartMoneyTracker', 'WhaleMonitor', 'MarketSentiment',
      'TradingGuard', 'TradeFilterPipeline', 'ExitDecisionEngine',
    ],
  });

  let lastTokenScanDiagAt = 0;
  let lastBotDisabledLogAt = 0;
  let tokensIgnored = 0;
  let tokensPoolNotFound = 0;
  let tokensInPipeline = 0;
  let lastPipelineSummaryAt = 0;
  let lastValidationSimulationAt = 0;
  const forceValidationSimulation = process.env.FORCE_VALIDATION_SIMULATION === 'true' || process.env.VALIDATION_SIMULATION === 'true';

  workerManager.registerWorker(QueueName.TOKEN_SCAN, async (job) => {
    logger.info('TOKEN_SCAN: job recebido', { jobId: job.id, jobName: job.name });
    try {
      if (!(await isBotEnabled())) {
        if (Date.now() - lastBotDisabledLogAt > 60_000) {
          lastBotDisabledLogAt = Date.now();
          logger.info('TOKEN_SCAN: bot desligado no dashboard — jobs ignorados');
        }
        return;
      }
      BotHealthMonitor.recordEvent();
      const payload = job.data as TokenScanJobPayload;
      const { tokenInfo, skipReason } = await tokenScanner.processToken(payload);
      if (!tokenInfo) {
        tokensIgnored++;
        const reasonMsg = skipReason === 'cache' ? 'já em cache (duplicado)'
          : skipReason === 'no_mint' ? 'mint vazio no payload'
          : skipReason === 'account_not_found' ? 'conta mint não encontrada na chain'
          : skipReason === 'error' ? 'erro ao processar'
          : 'desconhecido';
        logger.info('TOKEN_SCAN: token ignorado', {
          motivo: reasonMsg,
          mint: payload.tokenInfo.mintAddress?.slice(0, 12) ?? 'vazio',
          source: payload.source,
        });
        return;
      }
      statsTracker.incrementTokensScanned();
      const poolAddress = payload.tokenInfo.poolAddress?.trim();
      const preferDex = payload.source === 'PumpFunListener' ? 'pumpfun' : undefined;
      logger.info('TOKEN_SCAN: token ok, buscando pool', { mint: tokenInfo.mintAddress.slice(0, 12), source: payload.source });
      const pool = await poolScanner.scanForPool(
        tokenInfo.mintAddress,
        poolAddress ? { poolAddress, dex: payload.tokenInfo.poolDex ?? 'pumpfun' } : undefined,
        preferDex,
      );
      logger.info('TOKEN_SCAN: pool scan concluído', {
        mint: tokenInfo.mintAddress.slice(0, 12),
        poolEncontrado: !!pool,
      });
      if (!pool) {
        tokensPoolNotFound++;
        logger.info('TOKEN_SCAN: pool não encontrado', {
          mint: tokenInfo.mintAddress.slice(0, 12),
          source: payload.source,
          poolAddress: poolAddress?.slice(0, 12),
        });
        return;
      }

      tokensInPipeline++;
      const now = Date.now();
      if (now - lastPipelineSummaryAt > 30_000) {
        lastPipelineSummaryAt = now;
        logger.info('TOKEN_SCAN: resumo pipeline', {
          ignorados: tokensIgnored,
          poolNaoEncontrado: tokensPoolNotFound,
          noPipeline: tokensInPipeline,
        });
      }

      logger.info('TOKEN_SCAN: token no pipeline', {
      mint: tokenInfo.mintAddress.slice(0, 12),
      liquidity: pool.liquidity.toFixed(2),
      source: payload.source,
    });

    {
        const tokenAgeSec = (Date.now() - tokenInfo.createdAt.getTime()) / 1000;
        const { holderData: fetchedHolderData, fromApi } = await holderVolumeFetcher.fetchHolderData(tokenInfo.mintAddress);
        const holderData: HolderData = fromApi ? fetchedHolderData : {
          holderCount: 0,
          topHolderPercent: 0,
          top5HolderPercent: 0,
          holderGrowthRate: 0,
          holdersDecreasing: false,
        };
        const buyTxHeuristic = fromApi && holderData.holderCount >= 1 ? holderData.holderCount : 0;
        const defaultVolumeContext: VolumeContext = {
          volume1min: 0,
          volume5minAvg: 0,
          buyTxLast60s: buyTxHeuristic,
          sellTxLast20: 0,
          buyTxLast20: buyTxHeuristic,
          volumeStillActive: false,
          sellVolumeRatio: 0,
          largestSellPercent: 0,
          volumePrev60s: 0,
          txnsPerMinute: 0,
          uniqueWalletsPerVolume: 0,
          avgTradeSize: 0,
          tradeSizeStdDev: 0,
          buyRatio: 0.5,
          tradeTimeDistributionScore: 0,
          selfTradingDetected: false,
          volumeDropPercent60s: 0,
        };
        const defaultSafetyData: SafetyData = {
          mintAuthorityDisabled: !tokenInfo.isMutable,
          freezeAuthorityAbsent: !tokenInfo.hasFreezable,
          isBlacklisted: false,
          rugScore: 70,
          devWalletSelling: false,
          mintAuthorityReEnabled: false,
          liquidityDropPercent60s: 0,
          liquidityDropPercent10s: 0,
          txFailureRate30s: 0,
          freezeAuthority: null,
          mintAuthority: null,
          sellTxFailureRate: 0,
          sellsFromSingleWallet: false,
          noSuccessfulSells10min: false,
          buyTaxPercent: 0,
          sellTaxPercent: 0,
          bundleDetected: false,
          honeypotSimulationPassed: true,
        };
        const defaultSmartMoneyData: SmartMoneyData = {
          smartMoneyHolding: false,
          smartMoneyScore: 0,
          tier1WalletsBuying: 0,
          tier2WalletsBuying: 0,
          smartWalletSellingPercent: 0,
          smartWalletFullExit: false,
        };
        const defaultWhaleData: WhaleActivityData = {
          whaleBuysLast5min: 0,
          whaleDistinctBuyers5min: 0,
          whaleSellsLast5min: 0,
          whaleDistinctSellers5min: 0,
          largestWhaleBuySol: 0,
          whaleFirstBuyerSelling: false,
          whaleWashTradeDetected: false,
          whaleConfidenceScore: 0,
        };
        const defaultSentimentData: SentimentData = {
          sentimentScore: 50,
          sentimentRegime: 'neutral',
          newTokenRateVsAvg: 1,
          avgPoolSizeVsAvg: 1,
          rugRateToday: 0,
          solTransferVolumeSpike: false,
          newWalletCreationRate: 0,
          dexVsCexRatio: 0,
          avgTxFee: 0,
          failedTxRate: 0,
        };
        const defaultTokenSentiment: TokenSentimentData = {
          holderCountVelocity: 0,
          txFrequency: 0,
          avgBuySizeTrend: 0,
          sellSizeDistribution: 'mixed',
          returnBuyerRate: 0,
        };

        const context: StrategyContext = {
          tokenInfo,
          poolInfo: pool,
          currentPrice: pool.price,
          liquidity: pool.liquidity,
          liquidityUsd: pool.liquidity * pool.price,
          volume: pool.volume24h,
          timestamp: Date.now(),
          tokenAgeSec,
          priceChangeFromLaunch: tokenInfo.initialPrice > 0
            ? ((pool.price - tokenInfo.initialPrice) / tokenInfo.initialPrice) * 100
            : 0,
          priceChangePercent5min: 0,
          priceStdDev30min: 0,
          holderData,
          volumeContext: defaultVolumeContext,
          safetyData: defaultSafetyData,
          smartMoneyData: defaultSmartMoneyData,
          whaleData: defaultWhaleData,
          sentimentData: defaultSentimentData,
          tokenSentiment: defaultTokenSentiment,
          priceSamples: [],
          previouslyTraded: false,
          priceDropFromPeak: 0,
          poolInitialSol: tokenInfo.initialLiquidity,
          marketRegime: riskManager.getMarketRegime(),
          solPriceChange24h: 0,

          price60sAgo: 0,
          priceRising: false,
          uniqueBuyers5min: 0,
          buySellRatio5min: 0.5,
          liquidityStable: true,
          tokenSource: tokenInfo.source === 'pumpfun' ? 'pumpfun' : tokenInfo.source === 'raydium' || tokenInfo.source === 'raydium_clmm' ? 'raydium' : 'unknown',
          pumpfunMarketCap: 0,
          pumpfunGraduated: false,
          pumpfunCreationRatePerHour: 0,
          consecutiveLosses: 0,
          dailyLossPercent: 0,
          solanaTps: 0,
          rpcErrorRate5min: 0,
          gasMultiplier: 1,
          hotWalletBalance: 1,
          jupiterAvailable: true,
          websocketConnected: true,
          databaseHealthy: true,
          redisConnected: true,
          btcPriceChange1h: 0,
          newTokensPerHour: 0,
          winRateLast20: 50,
          knownExploitActive: false,
          flashloanDetected: false,
        };

        const filterOutcome = await tradeFilterPipeline.runPipeline(context);
        if (!filterOutcome.passed) {
          const failedStep = filterOutcome.steps.find((s) => !s.passed);
          logger.info('Token rejeitado pelo filtro', {
            token: tokenInfo.mintAddress.slice(0, 12),
            step: failedStep?.step ?? 'unknown',
            reason: filterOutcome.rejectionReason,
            entryScore: filterOutcome.finalEntryScore.toFixed(1),
            holders: holderData.holderCount,
            liquidity: pool.liquidity.toFixed(2),
            durationMs: filterOutcome.totalDurationMs,
          });
          tradeFilterPipeline.logRejectionSummaryIfNeeded();
          return;
        }

        const results = await strategyRegistry.evaluateAll(context);
        const buySignal = strategyRegistry.getBestBuySignal(results);

        const guardStatus = tradingGuard.evaluateToken(tokenInfo.mintAddress, context);
        if (!guardStatus.canTrade) {
          logger.info('TradingGuard blocked trade', {
            token: tokenInfo.mintAddress,
            reason: guardStatus.reason,
          });
          return;
        }

        if (guardStatus.softRestriction) {
          logger.debug('TradingGuard soft restriction active', {
            reason: guardStatus.reason,
            sizeMultiplier: guardStatus.positionSizeMultiplier,
          });
        }

        if (buySignal && buySignal.confidence > 0) {
          const sizeSol = positionSizer.calculatePositionSize(buySignal.confidence);
          const baseSize = sizeSol > 0 ? sizeSol : buySignal.suggestedSizeSol;
          const finalSize = baseSize * guardStatus.positionSizeMultiplier;
          const dryRun = await getEffectiveDryRun(config);

          const riskCheck = await riskManager.preTradeCheck({
            tokenMint: tokenInfo.mintAddress,
            direction: 'buy',
            amountSol: finalSize,
            slippageBps: config.trading.defaultSlippageBps,
            strategyId: buySignal.triggerType ?? 'auto',
            dryRun,
          });

          if (riskCheck.approved) {
            logger.info('Trade aprovado — enfileirando compra', {
              tokenMint: tokenInfo.mintAddress.slice(0, 12),
              amountSol: finalSize.toFixed(4),
              dryRun,
              strategy: buySignal.triggerType,
            });
            await queueManager.addJob(QueueName.TRADE_EXECUTE, 'strategy-buy', {
              tradeRequest: {
                tokenMint: tokenInfo.mintAddress,
                direction: 'buy',
                amountSol: finalSize,
                slippageBps: config.trading.defaultSlippageBps,
                strategyId: buySignal.triggerType ?? 'auto',
                dryRun,
              },
            } satisfies TradeExecuteJobPayload);
          } else {
            statsTracker.incrementTradesBlocked();
            logger.info('Trade blocked by risk manager', { reason: riskCheck.reason });
          }
        } else {
          const skipReasons = results
            .filter((r) => r.signal === 'skip' && r.reason)
            .map((r) => r.reason)
            .slice(0, 3);
          logger.info('Token passou no filtro mas sem sinal de compra', {
            tokenMint: tokenInfo.mintAddress.slice(0, 12),
            holders: holderData.holderCount,
            liquidity: pool.liquidity.toFixed(2),
            bestConfidence: buySignal?.confidence ?? 0,
            skipReasons,
          });

          // Modo validação: força 1 simulação a cada 5 min quando dry run + token passou no filtro
          const dryRun = await getEffectiveDryRun(config);
          const validationCooldownMs = 5 * 60 * 1000;
          if (
            forceValidationSimulation &&
            dryRun &&
            pool.liquidity >= 0.5 &&
            Date.now() - lastValidationSimulationAt > validationCooldownMs
          ) {
            lastValidationSimulationAt = Date.now();
            const validationSizeSol = Math.max(0.05, getTierConfig(config.trading.strategyTier).entry.solSizeMin);
            logger.info('VALIDAÇÃO: forçando simulação de compra (dry run)', {
              tokenMint: tokenInfo.mintAddress.slice(0, 12),
              amountSol: validationSizeSol.toFixed(4),
            });
            await queueManager.addJob(QueueName.TRADE_EXECUTE, 'validation-simulation', {
              tradeRequest: {
                tokenMint: tokenInfo.mintAddress,
                direction: 'buy',
                amountSol: validationSizeSol,
                slippageBps: config.trading.defaultSlippageBps,
                strategyId: 'validation_simulation',
                dryRun: true,
              },
            } satisfies TradeExecuteJobPayload);
          }
        }
    }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      logger.error('TOKEN_SCAN: erro não tratado', { error: errMsg, stack: errStack });
    }
  }, 3);

  workerManager.registerWorker(QueueName.TRADE_EXECUTE, async (job) => {
    const payload = job.data as TradeExecuteJobPayload;
    const riskCheck = await riskManager.preTradeCheck(payload.tradeRequest);

    if (!riskCheck.approved) {
      statsTracker.incrementTradesBlocked();
      logger.warn('Trade rejected by risk manager', { reason: riskCheck.reason });
      return;
    }

    let executePositionId: string | undefined;
    if (payload.tradeRequest.direction === 'sell') {
      const sellPositions = positionManager.getOpenPositions()
        .filter((p) => p.tokenMint === payload.tradeRequest.tokenMint);
      if (sellPositions.length > 0) {
        executePositionId = sellPositions[0].id;
      }
    }

    const result = await tradeExecutor.execute(payload.tradeRequest, {
      positionId: executePositionId,
    });

    if (result.status === 'confirmed' && payload.tradeRequest.direction === 'buy') {
      const entryPrice = result.inputAmount > 0 ? result.outputAmount / result.inputAmount : 0;
      const position = await positionManager.openPosition(
        payload.tradeRequest.tokenMint,
        entryPrice,
        payload.tradeRequest.amountSol,
        result.outputAmount,
        payload.tradeRequest.strategyId,
      );
      exposureTracker.addExposure(payload.tradeRequest.amountSol);
      capitalManager.allocateCapital(payload.tradeRequest.amountSol);

      const exitCfg = getTierConfig(config.trading.strategyTier).exit;
      const exitTranches: ExitTranche[] = [
        { targetPercent: exitCfg.tp1.gainPercent, sellPercent: exitCfg.tp1.sellPercent, executed: false },
        { targetPercent: exitCfg.tp2.gainPercent, sellPercent: exitCfg.tp2.sellPercent, executed: false },
        { targetPercent: exitCfg.tp3.gainPercent, sellPercent: exitCfg.tp3.sellPercent, executed: false },
      ];

      const enhancedPos: EnhancedPosition = {
        ...position,
        peakPrice: entryPrice,
        stopLossState: 'WATCHING',
        trailingStopDelta: getTierConfig(config.trading.strategyTier).stopLoss.trailingStopDelta,
        currentStopPrice: entryPrice * (1 - getTierConfig(config.trading.strategyTier).stopLoss.hardStopPercent / 100),
        exitTranches,
        remainingPercent: 100,
        originalAmountSol: payload.tradeRequest.amountSol,
        originalTokenAmount: result.outputAmount,
        poolAddress: '',
      };

      stopLossManager.initializePosition(enhancedPos);

      await queueManager.addJob(QueueName.POSITION_MONITOR, 'monitor', {
        positionId: position.id,
        tokenMint: position.tokenMint,
      } satisfies PositionMonitorJobPayload);
    }

    if (result.status === 'confirmed' && payload.tradeRequest.direction === 'sell') {
      const positions = positionManager.getOpenPositions()
        .filter((p) => p.tokenMint === payload.tradeRequest.tokenMint);
      for (const pos of positions) {
        const exitPrice = result.inputAmount > 0 ? result.outputAmount / result.inputAmount : 0;
        const closedPos = await positionManager.closePosition(pos.id, exitPrice);
        exposureTracker.removeExposure(pos.amountSol);
        capitalManager.releaseCapital(pos.amountSol);
        stopLossManager.removePosition(pos.id);
        riskManager.recordTokenExit(pos.tokenMint);

        const won = closedPos.pnlSol > 0;
        positionSizer.recordTradeResult(won);
        if (closedPos.pnlSol < 0) {
          riskManager.recordRealizedLoss(Math.abs(closedPos.pnlSol));
        }
        riskManager.updatePortfolioValue(
          exposureTracker.getAvailableCapital() + exposureTracker.getTotalExposure(),
        );

        statsTracker.incrementTrades(won, closedPos.pnlSol);
      }
    } else if (result.status === 'confirmed' && payload.tradeRequest.direction === 'buy') {
      statsTracker.incrementTrades(false, 0);
    }
  }, 1);

  workerManager.registerWorker(QueueName.POSITION_MONITOR, async (_job) => {
    await positionTracker.checkPositions();
  }, 2);

  workerManager.registerWorker(QueueName.ALERT, async (job) => {
    const payload = job.data as AlertJobPayload;
    await alertService.sendAlert(payload.level, payload.message, payload.data);
  }, 2);

  listeners = [
    new LogsListener(queueManager),
    new ProgramAccountListener(queueManager),
    new TokenMintListener(queueManager),
    new RaydiumPoolListener(queueManager),
    new PumpFunListener(queueManager),
    new LiquidityListener(queueManager),
    new LargeTransactionListener(queueManager),
    new PollingFallbackListener(queueManager),
  ];

  const initiallyEnabled = await isBotEnabledNoCache();
  if (initiallyEnabled) {
    // PASSO 3: Teste de WebSocket antes de iniciar listeners
    await testWebSocket(connectionManager.getSubscriptionConnection());

    for (const listener of listeners) {
      await listener.start();
    }
  } else {
    connectionsPaused = true;
    setConnectionsPaused(true);
    connectionManager.stop();
    connectionManager.disconnectSubscription();
    if (webSocketManager) {
      await webSocketManager.disconnect();
    }
    logger.info('Bot iniciando desligado — conexões Helius pausadas');
  }

  // Verifica se WebSocket está recebendo dados (slot updates são frequentes) — só quando bot ligado
  if (!connectionsPaused) {
    const subConn = connectionManager.getSubscriptionConnection();
    let slotReceived = false;
    const slotSubId = subConn.onSlotChange(() => {
      if (!slotReceived) {
        slotReceived = true;
        logger.info('WebSocket OK: recebendo dados da Solana (slot subscription ativa)');
      }
    });
    setTimeout(() => {
      subConn.removeSlotChangeListener(slotSubId);
      if (!slotReceived) {
        logger.warn('WebSocket aviso: nenhum slot recebido em 30s — subscriptions (onLogs) podem não funcionar. Verifique HELIUS_WS_URL e plano Helius.', {
          hint: 'O @solana/web3.js onLogs tem bugs conhecidos. Considere Helius Enhanced Webhooks como alternativa.',
        });
      }
    }, 30_000);
  }

  positionTracker.start();

  statsSnapshot = new StatsSnapshot(statsTracker);
  statsSnapshot.start();

  diagnosticsInterval = setInterval(async () => {
    try {
      const redis = RedisClient.getInstance().getClient();
      const total = parseInt((await redis.get('diag:tokens_received_total')) ?? '0', 10);
      const stage1 = parseInt((await redis.get('diag:tokens_stage1_rejected')) ?? '0', 10);
      const stage2 = parseInt((await redis.get('diag:tokens_stage2_rejected')) ?? '0', 10);
      const stage3 = parseInt((await redis.get('diag:tokens_stage3_rejected')) ?? '0', 10);
      const stage4 = parseInt((await redis.get('diag:tokens_stage4_rejected')) ?? '0', 10);
      const stage5 = parseInt((await redis.get('diag:tokens_stage5_rejected')) ?? '0', 10);
      const stage6 = parseInt((await redis.get('diag:tokens_stage6_rejected')) ?? '0', 10);
      const passed = parseInt((await redis.get('diag:tokens_passed')) ?? '0', 10);

      logger.info(
        `[DIAGNOSTICS] Tokens recebidos total: ${total} | ` +
          `Stage 1 (blacklist/honeypot): ${stage1} | Stage 2 (liquidez/authority): ${stage2} | ` +
          `Stage 3 (rug score): ${stage3} | Stage 4 (holders/honeypot/entry): ${stage4} | ` +
          `Stage 5 (market context): ${stage5} | Stage 6 (balance/sizing): ${stage6} | ` +
          `Passaram todos os filtros: ${passed}`,
      );
    } catch (err) {
      logger.debug('Diagnostics interval error', { err: String(err) });
    }
  }, 60_000);

  // Watcher: quando bot desligado no dashboard, pausa conexões Helius (WebSocket + RPC)
  botEnabledWatcherInterval = setInterval(async () => {
    try {
      const enabled = await isBotEnabledNoCache();
      if (!enabled && !connectionsPaused) {
        connectionsPaused = true;
        setConnectionsPaused(true);
        logger.info('Bot desligado — pausando conexões Helius (WebSocket + RPC)');
        for (const listener of listeners) {
          await listener.stop();
        }
        connectionManager.stop();
        connectionManager.disconnectSubscription();
        if (webSocketManager) {
          await webSocketManager.disconnect();
        }
      } else if (enabled && connectionsPaused) {
        connectionsPaused = false;
        setConnectionsPaused(false);
        logger.info('Bot ligado — retomando conexões Helius');
        connectionManager.reconnectSubscription();
        connectionManager.startHealthCheck();
        await webSocketManager.connect();
        for (const listener of listeners) {
          await listener.start();
        }
      }
    } catch (err) {
      logger.debug('BotEnabledWatcher error', { err: String(err) });
    }
  }, 5000);

  logger.info(`Bot iniciado — capital mode: SMALL (${config.trading.totalCapitalSol} SOL), reconciliação: ${reconciliation.totalChecked} posições verificadas`, {
    version: BOT_VERSION,
    timestamp: new Date().toISOString(),
    strategies: strategyRegistry.getStrategyCount(),
    openPositions: positionManager.getOpenPositions().length,
    dryRun: config.bot.dryRun,
    reconciliation: {
      ok: reconciliation.ok,
      closedExternally: reconciliation.closedExternally,
      partialReconciled: reconciliation.partialReconciled,
      errors: reconciliation.errors,
    },
    stuckPositions: stuckPositionKeys.length,
    healthMonitor: 'active',
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Shutdown signal received: ${signal}`);

  try {
    if (botEnabledWatcherInterval) {
      clearInterval(botEnabledWatcherInterval);
      botEnabledWatcherInterval = null;
    }
    if (diagnosticsInterval) {
      clearInterval(diagnosticsInterval);
      diagnosticsInterval = null;
    }

    for (const listener of listeners) {
      await listener.stop();
    }

    if (botHealthMonitor) {
      botHealthMonitor.stop();
    }

    if (tradingGuard) {
      tradingGuard.destroy();
    }

    if (statsSnapshot) {
      statsSnapshot.stop();
    }

    if (workerManager) {
      await workerManager.shutdown();
    }

    if (queueManager) {
      await queueManager.shutdown();
    }

    if (webSocketManager) {
      await webSocketManager.disconnect();
    }

    if (connectionManager) {
      connectionManager.stop();
    }

    const redis = RedisClient.getInstance();
    await redis.disconnect();

    const db = DatabaseClient.getInstance();
    await db.disconnect();

    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Error during shutdown', { error: errorMsg });
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason: unknown) => {
  const errorMsg = reason instanceof Error ? reason.message : String(reason);
  logger.error('Unhandled rejection', { error: errorMsg });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

main().catch((error: unknown) => {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.error('Fatal error during startup', { error: errorMsg, stack });
  // Garante que o erro sempre apareça no stdout (Railway/containers podem truncar JSON)
  console.error('[FATAL]', errorMsg);
  if (stack) console.error(stack);
  process.exit(1);
});
