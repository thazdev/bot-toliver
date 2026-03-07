import type { TokenInfo } from './token.types.js';
import type { PoolInfo } from './pool.types.js';
import type { TradeResult } from './trade.types.js';
import type { Position } from './position.types.js';

export type BotEventType =
  | 'TOKEN_DETECTED'
  | 'POOL_CREATED'
  | 'TRADE_SUBMITTED'
  | 'TRADE_CONFIRMED'
  | 'POSITION_OPENED'
  | 'POSITION_CLOSED'
  | 'CIRCUIT_BREAKER_TRIGGERED'
  | 'ALERT_SENT'
  | 'ERROR';

export interface BotEventBase {
  type: BotEventType;
  timestamp: number;
}

export interface TokenDetectedEvent extends BotEventBase {
  type: 'TOKEN_DETECTED';
  data: TokenInfo;
}

export interface PoolCreatedEvent extends BotEventBase {
  type: 'POOL_CREATED';
  data: PoolInfo;
}

export interface TradeSubmittedEvent extends BotEventBase {
  type: 'TRADE_SUBMITTED';
  data: TradeResult;
}

export interface TradeConfirmedEvent extends BotEventBase {
  type: 'TRADE_CONFIRMED';
  data: TradeResult;
}

export interface PositionOpenedEvent extends BotEventBase {
  type: 'POSITION_OPENED';
  data: Position;
}

export interface PositionClosedEvent extends BotEventBase {
  type: 'POSITION_CLOSED';
  data: Position;
}

export interface CircuitBreakerTriggeredEvent extends BotEventBase {
  type: 'CIRCUIT_BREAKER_TRIGGERED';
  data: { reason: string; dailyLoss: number };
}

export interface AlertSentEvent extends BotEventBase {
  type: 'ALERT_SENT';
  data: { level: string; message: string };
}

export interface ErrorEvent extends BotEventBase {
  type: 'ERROR';
  data: { error: string; context: string };
}

export type BotEvent =
  | TokenDetectedEvent
  | PoolCreatedEvent
  | TradeSubmittedEvent
  | TradeConfirmedEvent
  | PositionOpenedEvent
  | PositionClosedEvent
  | CircuitBreakerTriggeredEvent
  | AlertSentEvent
  | ErrorEvent;
