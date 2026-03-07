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
import type { BaseListener } from './listeners/BaseListener.js';

import { RaydiumClient } from './dex/raydium/RaydiumClient.js';
import { PumpFunClient } from './dex/pumpfun/PumpFunClient.js';
import { PoolScanner } from './scanners/PoolScanner.js';
import { TokenScanner } from './scanners/TokenScanner.js';

import { TradeExecutor } from './execution/TradeExecutor.js';
import { PositionManager } from './positions/PositionManager.js';
import { PositionTracker } from './positions/PositionTracker.js';
import { PriceMonitor } from './monitoring/PriceMonitor.js';

import { ExposureTracker } from './risk/ExposureTracker.js';
import { CircuitBreaker } from './risk/CircuitBreaker.js';
import { RiskManager } from './risk/RiskManager.js';
import { CapitalManager } from './capital/CapitalManager.js';

import { StrategyRegistry } from './strategies/StrategyRegistry.js';
import { AlertService } from './alerts/AlertService.js';
import { StatsTracker } from './stats/StatsTracker.js';
import { StatsSnapshot } from './stats/StatsSnapshot.js';

let listeners: BaseListener[] = [];
let queueManager: QueueManager;
let workerManager: WorkerManager;
let webSocketManager: WebSocketManager;
let connectionManager: ConnectionManager;
let statsSnapshot: StatsSnapshot;

async function main(): Promise<void> {
  logger.info(`Solana Trading Bot v${BOT_VERSION} starting...`);

  const config = loadConfig();
  logger.info('Configuration loaded', { dryRun: config.bot.dryRun, logLevel: config.bot.logLevel });

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

  workerManager = new WorkerManager(queueConfig);

  const raydiumClient = new RaydiumClient();
  const pumpFunClient = new PumpFunClient();
  const poolScanner = new PoolScanner([raydiumClient, pumpFunClient]);
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
  const tradeExecutor = new TradeExecutor(config, queueManager);
  const positionTracker = new PositionTracker(positionManager, priceMonitor, queueManager, config);
  const strategyRegistry = new StrategyRegistry();
  const alertService = new AlertService(config);
  const statsTracker = new StatsTracker();

  workerManager.registerWorker(QueueName.TOKEN_SCAN, async (job) => {
    const payload = job.data as TokenScanJobPayload;
    const tokenInfo = await tokenScanner.processToken(payload);
    if (tokenInfo) {
      statsTracker.incrementTokensScanned();
      const pool = await poolScanner.scanForPool(tokenInfo.mintAddress);
      if (pool) {
        const context = {
          tokenInfo,
          poolInfo: pool,
          currentPrice: pool.price,
          liquidity: pool.liquidity,
          volume: 0,
          timestamp: Date.now(),
        };

        const results = await strategyRegistry.evaluateAll(context);
        const buySignal = strategyRegistry.getBestBuySignal(results);

        if (buySignal && buySignal.confidence > 0) {
          const riskCheck = await riskManager.preTradeCheck({
            tokenMint: tokenInfo.mintAddress,
            direction: 'buy',
            amountSol: buySignal.suggestedSizeSol,
            slippageBps: config.trading.defaultSlippageBps,
            strategyId: 'auto',
            dryRun: config.bot.dryRun,
          });

          if (riskCheck.approved) {
            await queueManager.addJob(QueueName.TRADE_EXECUTE, 'strategy-buy', {
              tradeRequest: {
                tokenMint: tokenInfo.mintAddress,
                direction: 'buy',
                amountSol: buySignal.suggestedSizeSol,
                slippageBps: config.trading.defaultSlippageBps,
                strategyId: 'auto',
                dryRun: config.bot.dryRun,
              },
            } satisfies TradeExecuteJobPayload);
          } else {
            statsTracker.incrementTradesBlocked();
            logger.info('Trade blocked by risk manager', { reason: riskCheck.reason });
          }
        }
      }
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

    const result = await tradeExecutor.execute(payload.tradeRequest);

    if (result.status === 'confirmed' && payload.tradeRequest.direction === 'buy') {
      const position = await positionManager.openPosition(
        payload.tradeRequest.tokenMint,
        result.inputAmount > 0 ? result.outputAmount / result.inputAmount : 0,
        payload.tradeRequest.amountSol,
        result.outputAmount,
        payload.tradeRequest.strategyId,
      );
      exposureTracker.addExposure(payload.tradeRequest.amountSol);
      capitalManager.allocateCapital(payload.tradeRequest.amountSol);

      await queueManager.addJob(QueueName.POSITION_MONITOR, 'monitor', {
        positionId: position.id,
        tokenMint: position.tokenMint,
      } satisfies PositionMonitorJobPayload);
    }

    if (result.status === 'confirmed' && payload.tradeRequest.direction === 'sell') {
      const positions = positionManager.getOpenPositions()
        .filter((p) => p.tokenMint === payload.tradeRequest.tokenMint);
      for (const pos of positions) {
        await positionManager.closePosition(pos.id, result.outputAmount / result.inputAmount);
        exposureTracker.removeExposure(pos.amountSol);
        capitalManager.releaseCapital(pos.amountSol);
      }
    }

    const won = result.status === 'confirmed' && payload.tradeRequest.direction === 'sell';
    statsTracker.incrementTrades(won, 0);
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
  ];

  for (const listener of listeners) {
    await listener.start();
  }

  positionTracker.start();

  statsSnapshot = new StatsSnapshot(statsTracker);
  statsSnapshot.start();

  logger.info(`Bot initialized and listening`, {
    version: BOT_VERSION,
    timestamp: new Date().toISOString(),
    strategies: strategyRegistry.getStrategyCount(),
    openPositions: positionManager.getOpenPositions().length,
    dryRun: config.bot.dryRun,
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Shutdown signal received: ${signal}`);

  try {
    for (const listener of listeners) {
      await listener.stop();
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
  logger.error('Fatal error during startup', { error: errorMsg });
  process.exit(1);
});
