import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { PositionRepository } from '../core/database/repositories/PositionRepository.js';
import { PnLCalculator } from './PnLCalculator.js';
import type { Position } from '../types/position.types.js';
import type { AppConfig } from '../types/config.types.js';

/**
 * Manages the lifecycle of trading positions.
 * Maintains in-memory state and syncs to the database.
 */
export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private positionRepository: PositionRepository;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.positionRepository = new PositionRepository();
    this.config = config;
  }

  /**
   * Loads open positions from the database into memory on startup.
   */
  async loadFromDatabase(): Promise<void> {
    try {
      const openPositions = await this.positionRepository.findOpen();
      for (const pos of openPositions) {
        this.positions.set(pos.id, pos);
      }
      logger.info('PositionManager: loaded open positions', { count: openPositions.length });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PositionManager: failed to load positions', { error: errorMsg });
    }
  }

  /**
   * Opens a new position.
   * @param tokenMint - Token mint address
   * @param entryPrice - Entry price in SOL
   * @param amountSol - Amount invested in SOL
   * @param tokenAmount - Token amount received
   * @param strategyId - ID of the strategy that triggered the trade
   * @returns The newly created Position
   */
  async openPosition(
    tokenMint: string,
    entryPrice: number,
    amountSol: number,
    tokenAmount: number,
    strategyId: string,
  ): Promise<Position> {
    const openCount = this.getOpenPositions().length;
    if (openCount >= this.config.trading.maxOpenPositions) {
      throw new Error(`Max open positions reached: ${openCount}/${this.config.trading.maxOpenPositions}`);
    }

    const position: Position = {
      id: randomUUID(),
      tokenMint,
      entryPrice,
      currentPrice: entryPrice,
      amountSol,
      tokenAmount,
      status: 'open',
      strategyId,
      openedAt: new Date(),
      closedAt: null,
      pnlSol: 0,
      pnlPercent: 0,
      stopLoss: this.config.trading.stopLossPercent,
      takeProfit: this.config.trading.takeProfitPercent,
    };

    this.positions.set(position.id, position);

    try {
      await this.positionRepository.save(position);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PositionManager: failed to save new position', {
        positionId: position.id,
        error: errorMsg,
      });
    }

    logger.info('Position opened', {
      positionId: position.id,
      tokenMint,
      entryPrice,
      amountSol,
      strategyId,
    });

    return position;
  }

  /**
   * Closes an existing position.
   * @param positionId - The position ID to close
   * @param exitPrice - The exit price in SOL
   * @returns The closed Position
   */
  async closePosition(positionId: string, exitPrice: number): Promise<Position> {
    const position = this.positions.get(positionId);
    if (!position) {
      throw new Error(`Position not found: ${positionId}`);
    }

    const pnl = PnLCalculator.calculatePnL(position, exitPrice);

    position.currentPrice = exitPrice;
    position.status = 'closed';
    position.closedAt = new Date();
    position.pnlSol = pnl.pnlSol;
    position.pnlPercent = pnl.pnlPercent;

    try {
      await this.positionRepository.update(position);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PositionManager: failed to update closed position', {
        positionId,
        error: errorMsg,
      });
    }

    logger.info('Position closed', {
      positionId,
      tokenMint: position.tokenMint,
      pnlSol: pnl.pnlSol,
      pnlPercent: pnl.pnlPercent.toFixed(2),
    });

    return position;
  }

  /**
   * Updates a position's current price and PnL.
   * @param positionId - The position ID
   * @param currentPrice - Current price in SOL
   */
  async updatePosition(positionId: string, currentPrice: number): Promise<void> {
    const position = this.positions.get(positionId);
    if (!position || position.status !== 'open') {
      return;
    }

    const pnl = PnLCalculator.calculatePnL(position, currentPrice);
    position.currentPrice = currentPrice;
    position.pnlSol = pnl.pnlSol;
    position.pnlPercent = pnl.pnlPercent;

    try {
      await this.positionRepository.update(position);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('PositionManager: failed to update position', {
        positionId,
        error: errorMsg,
      });
    }
  }

  /**
   * Returns all currently open positions.
   * @returns Array of open positions
   */
  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter((p) => p.status === 'open');
  }

  /**
   * Gets a specific position by ID.
   * @param positionId - The position ID
   * @returns Position or null
   */
  getPosition(positionId: string): Position | null {
    return this.positions.get(positionId) ?? null;
  }

  /**
   * Checks if there's an open position for a given token mint.
   * @param tokenMint - The token mint address
   * @returns True if an open position exists for this mint
   */
  hasOpenPosition(tokenMint: string): boolean {
    return this.getOpenPositions().some((p) => p.tokenMint === tokenMint);
  }
}
