import { Redis } from 'ioredis';
import { logger } from '../utils/logger.js';
import { RedisClient } from './cache/RedisClient.js';

export type BotState = 'RUNNING' | 'STOPPED' | 'STARTING' | 'STOPPING';

const REDIS_STATE_KEY = 'bot:lifecycle_state';
const REDIS_ENABLED_KEY = 'bot:enabled';
const REDIS_COMMAND_CHANNEL = 'bot:command';

type StopCallback = () => Promise<void> | void;
type StartCallback = () => Promise<void> | void;

/**
 * Controla o ciclo de vida do bot com estados explícitos.
 * Quando STOPPED: zero I/O externo, processo idle, apenas escuta Redis pub/sub.
 * Quando RUNNING: todas as conexões e loops ativos.
 */
export class BotLifecycle {
  private static instance: BotLifecycle | null = null;

  private state: BotState = 'STOPPED';
  private subscriber: Redis | null = null;
  private stopCallbacks: StopCallback[] = [];
  private startCallbacks: StartCallback[] = [];
  private transitionPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): BotLifecycle {
    if (!BotLifecycle.instance) {
      BotLifecycle.instance = new BotLifecycle();
    }
    return BotLifecycle.instance;
  }

  getState(): BotState {
    return this.state;
  }

  isRunning(): boolean {
    return this.state === 'RUNNING';
  }

  isStopped(): boolean {
    return this.state === 'STOPPED';
  }

  /**
   * Registra callback chamado durante STOPPING (desligar conexões, cancelar timers).
   * Callbacks são executados na ordem registrada.
   */
  onStop(cb: StopCallback): void {
    this.stopCallbacks.push(cb);
  }

  /**
   * Registra callback chamado durante STARTING (reconectar WS, reiniciar listeners).
   * Callbacks são executados na ordem registrada.
   */
  onStart(cb: StartCallback): void {
    this.startCallbacks.push(cb);
  }

  /**
   * Inicia o subscriber Redis dedicado que escuta comandos do dashboard.
   * Este subscriber permanece vivo mesmo quando o bot está STOPPED.
   */
  async startCommandListener(): Promise<void> {
    const redisClient = RedisClient.getInstance().getClient();
    this.subscriber = redisClient.duplicate();

    this.subscriber.on('error', (err) => {
      logger.error('BotLifecycle: Redis subscriber error', { error: err.message });
    });

    await this.subscriber.subscribe(REDIS_COMMAND_CHANNEL);

    this.subscriber.on('message', (_channel: string, raw: string) => {
      let action = raw;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.action === 'string') action = parsed.action;
      } catch {}

      if (action === 'start' && this.state === 'STOPPED') {
        void this.start();
      } else if (action === 'stop' && this.state === 'RUNNING') {
        void this.stop();
      }
    });

    logger.warn('BotLifecycle: command listener active on channel ' + REDIS_COMMAND_CHANNEL);
  }

  /**
   * Checa o estado inicial do Redis e transiciona de acordo.
   * Chamado uma vez no boot do processo.
   */
  async checkInitialState(): Promise<boolean> {
    try {
      const redis = RedisClient.getInstance().getClient();
      const val = await redis.get(REDIS_ENABLED_KEY);
      return val !== 'false';
    } catch {
      return true;
    }
  }

  /**
   * Polling de fallback para o estado habilitado no Redis.
   * Usado como safety net caso o pub/sub perca a mensagem.
   * Intervalo alto (30s) para minimizar requests.
   */
  private fallbackInterval: ReturnType<typeof setInterval> | null = null;

  startFallbackPolling(): void {
    this.fallbackInterval = setInterval(async () => {
      try {
        const redis = RedisClient.getInstance().getClient();
        const val = await redis.get(REDIS_ENABLED_KEY);
        const shouldBeRunning = val !== 'false';

        if (shouldBeRunning && this.state === 'STOPPED') {
          logger.warn('BotLifecycle: fallback polling detected enable — starting');
          void this.start();
        } else if (!shouldBeRunning && this.state === 'RUNNING') {
          logger.warn('BotLifecycle: fallback polling detected disable — stopping');
          void this.stop();
        }
      } catch (err) {
        logger.debug('BotLifecycle: fallback poll error', { err: String(err) });
      }
    }, 30_000);
  }

  async start(): Promise<void> {
    if (this.state === 'RUNNING' || this.state === 'STARTING') return;
    if (this.transitionPromise) await this.transitionPromise;

    this.transitionPromise = this._start();
    await this.transitionPromise;
    this.transitionPromise = null;
  }

  private async _start(): Promise<void> {
    const t0 = Date.now();
    this.state = 'STARTING';
    await this.writeState();
    logger.warn('BotLifecycle: STARTING');

    for (const cb of this.startCallbacks) {
      try {
        await cb();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('BotLifecycle: start callback failed', { error: msg });
      }
    }

    this.state = 'RUNNING';
    await this.writeState();
    logger.warn(`BotLifecycle: RUNNING (transição em ${Date.now() - t0}ms)`);
  }

  async stop(): Promise<void> {
    if (this.state === 'STOPPED' || this.state === 'STOPPING') return;
    if (this.transitionPromise) await this.transitionPromise;

    this.transitionPromise = this._stop();
    await this.transitionPromise;
    this.transitionPromise = null;
  }

  private async _stop(): Promise<void> {
    const t0 = Date.now();
    this.state = 'STOPPING';
    await this.writeState();
    logger.warn('BotLifecycle: STOPPING');

    for (const cb of this.stopCallbacks) {
      try {
        await cb();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('BotLifecycle: stop callback failed', { error: msg });
      }
    }

    this.state = 'STOPPED';
    await this.writeState();
    logger.warn(`BotLifecycle: STOPPED (transição em ${Date.now() - t0}ms)`);
  }

  private async writeState(): Promise<void> {
    try {
      const redis = RedisClient.getInstance().getClient();
      await redis.setex(REDIS_STATE_KEY, 120, this.state);
    } catch {
      // Non-critical: dashboard pode ler bot:enabled como fallback
    }
  }

  /**
   * Shutdown completo — chamado no SIGTERM/SIGINT.
   * Desliga o subscriber Redis e limpa o intervalo de fallback.
   */
  async destroy(): Promise<void> {
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }
    if (this.subscriber) {
      await this.subscriber.unsubscribe(REDIS_COMMAND_CHANNEL).catch(() => {});
      await this.subscriber.quit().catch(() => {});
      this.subscriber = null;
    }
    BotLifecycle.instance = null;
  }
}
