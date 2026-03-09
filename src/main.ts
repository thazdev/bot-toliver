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
import { getTierConfig } from './strategies/config.js';
import { getEffectiveDryRun } from './config/DryRunResolver.js';
import { getOpenPositionsTotalSOL } from './services/DryRunPositionService.js';
import { isBotEnabled } from './config/BotEnabledResolver.js';
import { setConnectionsPaused } from './config/ConnectionsPausedResolver.js';
import { BotLifecycle } from './core/BotLifecycle.js';
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
import { startDryRunPositionMonitor, stopDryRunPositionMonitor } from './workers/DryRunPositionMonitor.js';
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
let diagnosticsInterval: ReturnType<typeof setInterval> | null = null;

function startDiagnosticsInterval(): void {
  if (diagnosticsInterval) return;
  diagnosticsInterval = setInterval(async () => {
    try {
      const redis = RedisClient.getInstance().getClient();
      const [total, passed] = await Promise.all([
        redis.get('diag:tokens_received_total'),
        redis.get('diag:tokens_passed'),
      ]);
      logger.debug('[DIAGNOSTICS]', {
        tokensTotal: parseInt(total ?? '0', 10),
        tokensPassed: parseInt(passed ?? '0', 10),
      });
    } catch (err) {
      logger.debug('Diagnostics interval error', { err: String(err) });
    }
  }, 60_000);
}

/** PASSO 3: Teste de conectividade WebSocket isolado — escuta QUALQUER log na rede por 30s */
async function testWebSocket(connection: Connection): Promise<void> {
  logger.debug('WS_TEST: Starting WebSocket connectivity test...');

  let receivedAny = false;

  const subId = connection.onLogs(
    'all' as never,
    (logs: { signature: string; logs?: string[] }) => {
      if (!receivedAny) {
        receivedAny = true;
        logger.debug('WS_TEST: WebSocket is working — first log received', {
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
    logger.debug('WS_TEST PASSED: WebSocket connectivity confirmed');
  }
}

async function main(): Promise<void> {
  (globalThis as { __botStartTime?: number }).__botStartTime = Date.now();
  logger.warn(`Solana Trading Bot v${BOT_VERSION} starting...`);

  const config = loadConfig();
  logger.debug('Configuration loaded', { dryRun: config.bot.dryRun, logLevel: config.bot.logLevel });

  logger.debug('ENV_CHECK', {
    helius_rpc_set: !!process.env.HELIUS_RPC_URL,
    helius_ws_set: !!process.env.HELIUS_WS_URL,
    helius_ws_starts_with_wss: process.env.HELIUS_WS_URL?.startsWith('wss://'),
    wallet_set: !!process.env.WALLET_PRIVATE_KEY,
    strategy_tier: config.trading.strategyTier,
    redis_connected: false,
    mysql_connected: false,
  });

  DatabaseClient.initialize(config.database);
  const db = DatabaseClient.getInstance();

  const dbMaxRetries = parseInt(process.env.DB_CONNECT_RETRIES ?? '10', 10) || 10;
  const dbRetryDelayMs = parseInt(process.env.DB_CONNECT_RETRY_DELAY_MS ?? '3000', 10) || 3000;

  for (let attempt = 1; attempt <= dbMaxRetries; attempt++) {
    const ok = await db.testConnection();
    if (ok) {
      try {
        const migrationRunner = new MigrationRunner();
        await migrationRunner.run();
        break;
      } catch (migrationErr) {
        const msg = migrationErr instanceof Error ? migrationErr.message : String(migrationErr);
        logger.warn(`Migration attempt ${attempt}/${dbMaxRetries} failed`, { error: msg });
        if (attempt === dbMaxRetries) throw migrationErr;
      }
    } else {
      logger.warn(`Database attempt ${attempt}/${dbMaxRetries} failed. Aguardando ${dbRetryDelayMs}ms...`, {
        host: config.database.host,
        hint: config.database.host?.includes('railway.internal')
          ? 'mysql.railway.internal só resolve na rede Railway. Use MYSQL_HOST com URL pública se rodando fora.'
          : undefined,
      });
      if (attempt === dbMaxRetries) {
        throw new Error(`Database failed after ${dbMaxRetries} attempts. MYSQL_HOST=${config.database.host}`);
      }
    }
    await new Promise((r) => setTimeout(r, dbRetryDelayMs));
  }

  RedisClient.initialize(config.redis);

  connectionManager = ConnectionManager.initialize(config.solana, config.rateLimit);
  connectionManager.startHealthCheck();

  webSocketManager = new WebSocketManager(config.solana.heliusWsUrl);
  await webSocketManager.connect();

  const queueConfig = loadQueueConfig(config.redis);
  queueManager = new QueueManager(queueConfig);
  await queueManager.initialize();

  logger.debug('ENV_CHECK', {
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
  const tradeExecutor = new TradeExecutor(config, queueManager, transactionManager, poolScanner);

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

  logger.debug('Strategies and analyzers initialized', {
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

  workerManager.registerWorker(QueueName.TOKEN_SCAN, async (job) => {
    logger.debug('TOKEN_SCAN: job recebido', { jobId: job.id, jobName: job.name });
    try {
      if (!(await isBotEnabled())) {
        if (Date.now() - lastBotDisabledLogAt > 60_000) {
          lastBotDisabledLogAt = Date.now();
          logger.debug('TOKEN_SCAN: bot desligado no dashboard — jobs ignorados');
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
        logger.debug('TOKEN_SCAN: token ignorado', {
          motivo: reasonMsg,
          mint: payload.tokenInfo.mintAddress?.slice(0, 12) ?? 'vazio',
          source: payload.source,
        });
        return;
      }
      statsTracker.incrementTokensScanned();
      const poolAddress = payload.tokenInfo.poolAddress?.trim();
      const preferDex = payload.tokenInfo.poolDex ?? (payload.source === 'PumpFunListener' ? 'pumpfun' : undefined);
      logger.debug('TOKEN_SCAN: token ok, buscando pool', { mint: tokenInfo.mintAddress.slice(0, 12), source: payload.source });
      const pool = await poolScanner.scanForPool(
        tokenInfo.mintAddress,
        poolAddress ? { poolAddress, dex: payload.tokenInfo.poolDex ?? 'pumpfun' } : undefined,
        preferDex,
      );
      logger.debug('TOKEN_SCAN: pool scan concluído', {
        mint: tokenInfo.mintAddress.slice(0, 12),
        poolEncontrado: !!pool,
      });
      if (!pool) {
        tokensPoolNotFound++;
        logger.debug('TOKEN_SCAN: pool não encontrado', {
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
        logger.debug('TOKEN_SCAN: resumo pipeline', {
          ignorados: tokensIgnored,
          poolNaoEncontrado: tokensPoolNotFound,
          noPipeline: tokensInPipeline,
        });
      }

      logger.debug('TOKEN_SCAN: token no pipeline', {
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
          mintAuthorityDisabled: !tokenInfo.hasMintAuthority,
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
          logger.debug('Token rejeitado pelo filtro', {
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

        const tokenMint = tokenInfo.mintAddress;
        const redis = RedisClient.getInstance().getClient();
        const existingDebug = await redis.get('debug:last_passed_token');
        if (!existingDebug) {
          await redis.set('debug:last_passed_token', tokenMint, 'EX', 300);
        }
        const debugToken = await redis.get('debug:last_passed_token');
        const isDebugToken = debugToken !== null && tokenMint === debugToken;

        if (isDebugToken) {
          logger.debug('DEBUG_TRACE: PIPELINE_PASSED', {
            tokenMint: tokenMint.slice(0, 12),
            entryScore: filterOutcome.finalEntryScore,
          });
        }

        const results = await strategyRegistry.evaluateAll(context);
        let buySignal = strategyRegistry.getBestBuySignal(results);

        // Salvar no Redis para diagnóstico: tokens que passaram o pipeline
        try {
          const skipReasons = results
            .filter((r) => r.signal === 'skip' && r.reason)
            .map((r) => r.reason!)
            .slice(0, 5);
          const entry = JSON.stringify({
            mint: tokenMint,
            entryScore: filterOutcome.finalEntryScore,
            liquidity: context.liquidity,
            holders: context.holderData.holderCount,
            hasBuySignal: buySignal !== null,
            skipReasons,
            tradeExecuted: false,
            timestamp: new Date().toISOString(),
          });
          await redis.lpush('diag:passed_tokens_log', entry);
          await redis.ltrim('diag:passed_tokens_log', 0, 49);
        } catch (_) {}

        if (isDebugToken) {
          logger.debug('DEBUG_TRACE: STRATEGY_SIGNAL', {
            tokenMint: tokenMint.slice(0, 12),
            hasBuySignal: buySignal !== null,
            confidence: buySignal?.confidence ?? 0,
            strategyName: buySignal?.triggerType ?? 'none',
          });
        }

        const guardStatus = tradingGuard.evaluateToken(tokenInfo.mintAddress, context);

        if (isDebugToken) {
          logger.debug('DEBUG_TRACE: GUARD_RESULT', {
            tokenMint: tokenMint.slice(0, 12),
            canTrade: guardStatus.canTrade,
            reason: guardStatus.reason ?? 'ok',
          });
        }
        if (!guardStatus.canTrade) {
          const blockReason = guardStatus.reason?.trim() || 'TradingGuard_blocked';
          logger.debug('RAW_BLOCK_DEBUG', {
            tokenMint,
            source: 'TradingGuard',
            guardStatusRaw: JSON.stringify(guardStatus),
          });
          logger.debug('TRADE_BLOCKED_REASON', {
            tokenMint,
            source: 'TradingGuard',
            reason: blockReason,
          });
          try {
            const rawList = await redis.lrange('diag:passed_tokens_log', 0, 49);
            const updated = rawList.map((s) => {
              try {
                const obj = JSON.parse(s) as { mint: string; tradeBlockReason?: string };
                if (obj.mint === tokenMint) {
                  return JSON.stringify({ ...obj, tradeBlockReason: blockReason });
                }
                return s;
              } catch {
                return s;
              }
            });
            if (updated.some((s, i) => s !== rawList[i])) {
              await redis.del('diag:passed_tokens_log');
              for (let i = updated.length - 1; i >= 0; i--) {
                await redis.lpush('diag:passed_tokens_log', updated[i]);
              }
            }
          } catch (_) {}
          if (isDebugToken) {
            logger.debug('=== FULL_TRACE_TOKEN ===', {
              tokenMint: tokenMint.slice(0, 12),
              pipeline: 'PASSED',
              hasBuySignal: buySignal !== null,
              guardCanTrade: guardStatus.canTrade,
              guardReason: guardStatus.reason,
              executingTrade: false,
            });
          }
          logger.debug('TradingGuard blocked trade', {
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
          const dryRun = await getEffectiveDryRun(config);
          // Atualizar exposure com posições dry run abertas (capital em uso)
          if (dryRun) {
            const dryRunExposure = await getOpenPositionsTotalSOL();
            const realExposure = positionManager.getOpenPositions().reduce((s, p) => s + p.amountSol, 0);
            exposureTracker.setExposure(realExposure + dryRunExposure);
          }

          const sizeSol = positionSizer.calculatePositionSize(buySignal.confidence);
          const baseSize = sizeSol > 0 ? sizeSol : buySignal.suggestedSizeSol;
          const finalSize = baseSize * guardStatus.positionSizeMultiplier;
          const minSize = getTierConfig(config.trading.strategyTier).sizing.minPositionSol;

          if (isDebugToken) {
            logger.debug('DEBUG_TRACE: POSITION_SIZE', {
              tokenMint: tokenMint.slice(0, 12),
              calculatedSize: sizeSol,
              minSize,
              blocked: sizeSol < minSize,
            });
          }

          const riskCheck = await riskManager.preTradeCheck({
            tokenMint: tokenInfo.mintAddress,
            direction: 'buy',
            amountSol: finalSize,
            slippageBps: config.trading.defaultSlippageBps,
            strategyId: buySignal.triggerType ?? 'auto',
            dryRun,
          });

          if (riskCheck.approved) {
            if (isDebugToken) {
              logger.debug('DEBUG_TRACE: EXECUTING_TRADE', {
                tokenMint: tokenMint.slice(0, 12),
                dryRun,
                amountSOL: finalSize,
              });
              logger.debug('=== FULL_TRACE_TOKEN ===', {
                tokenMint: tokenMint.slice(0, 12),
                pipeline: 'PASSED',
                hasBuySignal: true,
                riskApproved: riskCheck.approved,
                executingTrade: true,
              });
            }
            logger.warn('Trade aprovado — enfileirando compra', {
              tokenMint: tokenInfo.mintAddress.slice(0, 12),
              amountSol: finalSize.toFixed(4),
              dryRun,
              strategy: buySignal.triggerType,
            });
            const strategyId = buySignal.triggerType ?? 'auto';
            await queueManager.addJob(QueueName.TRADE_EXECUTE, 'strategy-buy', {
              tradeRequest: {
                tokenMint: tokenInfo.mintAddress,
                direction: 'buy',
                amountSol: finalSize,
                slippageBps: config.trading.defaultSlippageBps,
                strategyId,
                dryRun,
                entryScore: filterOutcome.finalEntryScore,
              },
              entryScore: filterOutcome.finalEntryScore,
            } satisfies TradeExecuteJobPayload);
          } else {
            const blockReason = riskCheck.reason?.trim() || 'riskcheck_returned_no_reason';
            const openPositions = positionManager.getOpenPositions();
            const maxPositions = getTierConfig(config.trading.strategyTier).sizing.maxConcurrentPositions;
            const availableCapital = exposureTracker.getAvailableCapital();
            const totalExposure = exposureTracker.getTotalExposure();
            logger.warn('RAW_BLOCK_DEBUG', {
              tokenMint,
              source: 'RiskCheck',
              riskCheckRaw: JSON.stringify(riskCheck),
              positionSizerRaw: JSON.stringify({ sizeSol, finalSize, minSize, baseSize }),
              balanceRaw: availableCapital,
              isDryRun: config.bot.dryRun,
              openPositions: openPositions.length,
              dailyLoss: context.dailyLossPercent,
              consecutiveLosses: context.consecutiveLosses,
            });
            logger.debug('TRADE_BLOCKED_REASON', {
            tokenMint,
            riskReason: blockReason,
            positionSize: sizeSol,
            dryRun,
          });
            try {
              const rawList = await redis.lrange('diag:passed_tokens_log', 0, 49);
              const updated = rawList.map((s) => {
                try {
                  const obj = JSON.parse(s) as { mint: string; tradeBlockReason?: string };
                  if (obj.mint === tokenMint) {
                    return JSON.stringify({ ...obj, tradeBlockReason: blockReason });
                  }
                  return s;
                } catch {
                  return s;
                }
              });
              if (updated.some((s, i) => s !== rawList[i])) {
                await redis.del('diag:passed_tokens_log');
                for (let i = updated.length - 1; i >= 0; i--) {
                  await redis.lpush('diag:passed_tokens_log', updated[i]);
                }
              }
            } catch (_) {}
            if (isDebugToken) {
              logger.debug('=== FULL_TRACE_TOKEN ===', {
                tokenMint: tokenMint.slice(0, 12),
                riskApproved: riskCheck.approved,
                executingTrade: false,
              });
            }
            statsTracker.incrementTradesBlocked();
            logger.warn('TRADE_BLOCKED', { tokenMint, reason: blockReason });
          }
        } else {
          // Token passou no pipeline mas sem sinal de compra — definir reason para evitar "unknown" no dashboard
          const noBuyReason = 'no_buy_signal';
          try {
            const rawList = await redis.lrange('diag:passed_tokens_log', 0, 49);
            const updated = rawList.map((s) => {
              try {
                const obj = JSON.parse(s) as { mint: string; tradeBlockReason?: string };
                if (obj.mint === tokenMint) {
                  return JSON.stringify({ ...obj, tradeBlockReason: noBuyReason });
                }
                return s;
              } catch {
                return s;
              }
            });
            if (updated.some((s, i) => s !== rawList[i])) {
              await redis.del('diag:passed_tokens_log');
              for (let i = updated.length - 1; i >= 0; i--) {
                await redis.lpush('diag:passed_tokens_log', updated[i]);
              }
            }
          } catch (_) {}
          if (isDebugToken) {
            logger.debug('=== FULL_TRACE_TOKEN ===', {
              tokenMint: tokenMint.slice(0, 12),
              hasBuySignal: false,
              executingTrade: false,
            });
          }
          const skipReasons = results
            .filter((r) => r.signal === 'skip' && r.reason)
            .map((r) => r.reason)
            .slice(0, 3);
          logger.debug('Token passou no filtro mas sem sinal de compra', {
            tokenMint: tokenInfo.mintAddress.slice(0, 12),
            holders: holderData.holderCount,
            liquidity: pool.liquidity.toFixed(2),
          });

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
      const blockReason = riskCheck.reason?.trim() || 'riskcheck_returned_no_reason';
      logger.debug('RAW_BLOCK_DEBUG', {
        tokenMint: payload.tradeRequest.tokenMint,
        source: 'TRADE_EXECUTE_worker',
        riskReason: blockReason,
        dryRun: payload.tradeRequest.dryRun,
      });
      try {
        const redis = RedisClient.getInstance().getClient();
        const rawList = await redis.lrange('diag:passed_tokens_log', 0, 49);
        const updated = rawList.map((s) => {
          try {
            const obj = JSON.parse(s) as { mint: string; tradeBlockReason?: string };
            if (obj.mint === payload.tradeRequest.tokenMint) {
              return JSON.stringify({ ...obj, tradeBlockReason: blockReason });
            }
            return s;
          } catch {
            return s;
          }
        });
        if (updated.some((s, i) => s !== rawList[i])) {
          await redis.del('diag:passed_tokens_log');
          for (let i = updated.length - 1; i >= 0; i--) {
            await redis.lpush('diag:passed_tokens_log', updated[i]);
          }
        }
      } catch (_) {}
      statsTracker.incrementTradesBlocked();
      logger.warn('TRADE_BLOCKED', { tokenMint: payload.tradeRequest.tokenMint, reason: blockReason });
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

  // ── BotLifecycle: controle centralizado de start/stop ──
  const lifecycle = BotLifecycle.getInstance();

  lifecycle.onStop(async () => {
    setConnectionsPaused(true);
    for (const listener of listeners) {
      await listener.stop();
    }
    connectionManager.stop();
    connectionManager.disconnectSubscription();
    if (webSocketManager) {
      await webSocketManager.disconnect();
    }
    if (diagnosticsInterval) {
      clearInterval(diagnosticsInterval);
      diagnosticsInterval = null;
    }
    if (botHealthMonitor) {
      botHealthMonitor.stop();
    }
    if (tradingGuard) {
      tradingGuard.destroy();
    }
    stopDryRunPositionMonitor();
    if (statsSnapshot) {
      statsSnapshot.stop();
    }
    positionTracker.stop();
  });

  lifecycle.onStart(async () => {
    setConnectionsPaused(false);
    connectionManager.reconnectSubscription();
    connectionManager.startHealthCheck();
    await webSocketManager.connect();
    for (const listener of listeners) {
      await listener.start();
    }
    botHealthMonitor = BotHealthMonitor.initialize(tradingGuard);
    botHealthMonitor.start();
    positionTracker.start();
    startDryRunPositionMonitor({ poolScanner });
    statsSnapshot = new StatsSnapshot(statsTracker);
    statsSnapshot.start();
    startDiagnosticsInterval();
  });

  await lifecycle.startCommandListener();
  lifecycle.startFallbackPolling();

  const initiallyEnabled = await lifecycle.checkInitialState();
  if (initiallyEnabled) {
    await testWebSocket(connectionManager.getSubscriptionConnection());

    for (const listener of listeners) {
      await listener.start();
    }
    setConnectionsPaused(false);

    const subConn = connectionManager.getSubscriptionConnection();
    let slotReceived = false;
    const slotSubId = subConn.onSlotChange(() => {
      if (!slotReceived) {
        slotReceived = true;
        logger.warn('WebSocket OK: recebendo dados da Solana (slot subscription ativa)');
      }
    });
    setTimeout(() => {
      subConn.removeSlotChangeListener(slotSubId);
      if (!slotReceived) {
        logger.warn('WebSocket aviso: nenhum slot recebido em 30s — subscriptions podem não funcionar');
      }
    }, 30_000);

    positionTracker.start();
    startDryRunPositionMonitor({ poolScanner });
    statsSnapshot = new StatsSnapshot(statsTracker);
    statsSnapshot.start();
    startDiagnosticsInterval();
    botHealthMonitor = BotHealthMonitor.initialize(tradingGuard);
    botHealthMonitor.start();

    (lifecycle as unknown as { state: string }).state = 'RUNNING';
    try {
      const redis = RedisClient.getInstance().getClient();
      await redis.set('bot:lifecycle_state', 'RUNNING');
    } catch {}
  } else {
    setConnectionsPaused(true);
    connectionManager.stop();
    connectionManager.disconnectSubscription();
    if (webSocketManager) {
      await webSocketManager.disconnect();
    }
    logger.warn('Bot iniciando desligado — conexões Helius pausadas, estado STOPPED');
  }

  logger.warn(`Bot iniciado — capital: ${config.trading.totalCapitalSol} SOL, reconciliação: ${reconciliation.totalChecked} posições verificadas`, {
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
  logger.warn(`Shutdown signal received: ${signal}`);

  try {
    const lifecycle = BotLifecycle.getInstance();
    if (lifecycle.isRunning()) {
      await lifecycle.stop();
    }
    await lifecycle.destroy();

    if (diagnosticsInterval) {
      clearInterval(diagnosticsInterval);
      diagnosticsInterval = null;
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

    logger.warn('Graceful shutdown complete');
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
  process.stderr.write(`[FATAL] ${errorMsg}\n`);
  if (stack) process.stderr.write(`${stack}\n`);
  process.exit(1);
});
