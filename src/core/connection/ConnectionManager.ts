import { Connection, Keypair } from '@solana/web3.js';
import { logger } from '../../utils/logger.js';
import { RpcFallback } from './RpcFallback.js';
import { RateLimiter } from './RateLimiter.js';
import type { SolanaConfig, RateLimitConfig } from '../../types/config.types.js';

/**
 * Central Solana connection manager.
 * All RPC calls must go through this manager. It provides rate-limited,
 * fallback-aware connections and wallet access.
 */
export class ConnectionManager {
  private static instance: ConnectionManager | null = null;
  private rpcFallback: RpcFallback;
  private rateLimiter: RateLimiter;
  private wallet: Keypair;

  private constructor(solanaConfig: SolanaConfig, rateLimitConfig: RateLimitConfig) {
    this.rateLimiter = RateLimiter.initialize(rateLimitConfig);
    this.rpcFallback = new RpcFallback(solanaConfig.heliusRpcUrl, solanaConfig.fallbackRpcUrl);

    try {
      const keyBytes = Uint8Array.from(Buffer.from(solanaConfig.walletPrivateKey, 'base64'));
      if (keyBytes.length !== 64) {
        const decoded = this.decodeBase58(solanaConfig.walletPrivateKey);
        this.wallet = Keypair.fromSecretKey(decoded);
      } else {
        this.wallet = Keypair.fromSecretKey(keyBytes);
      }
    } catch {
      throw new Error('Invalid WALLET_PRIVATE_KEY: must be a valid base58 or base64 encoded secret key');
    }

    logger.info('ConnectionManager initialized', {
      primaryRpc: solanaConfig.heliusRpcUrl.slice(0, 30) + '...',
      walletPublicKey: this.wallet.publicKey.toBase58(),
    });
  }

  /**
   * Initializes the ConnectionManager singleton.
   * @param solanaConfig - Solana connection configuration
   * @param rateLimitConfig - Rate limiting configuration
   * @returns The singleton instance
   */
  static initialize(solanaConfig: SolanaConfig, rateLimitConfig: RateLimitConfig): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager(solanaConfig, rateLimitConfig);
    }
    return ConnectionManager.instance;
  }

  /**
   * Returns the singleton instance.
   * @returns The ConnectionManager instance
   */
  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      throw new Error('ConnectionManager not initialized. Call initialize() first.');
    }
    return ConnectionManager.instance;
  }

  /**
   * Returns the active, rate-limited Solana connection.
   * @returns The active Solana Connection
   */
  getConnection(): Connection {
    return this.rpcFallback.getConnection();
  }

  /**
   * Returns the bot wallet keypair.
   * @returns The Keypair for the bot wallet
   */
  getWallet(): Keypair {
    return this.wallet;
  }

  /**
   * Returns the RateLimiter for scheduling RPC calls.
   * @returns The RateLimiter instance
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /**
   * Starts health check monitoring on the RPC endpoints.
   */
  startHealthCheck(): void {
    this.rpcFallback.startHealthCheck();
  }

  /**
   * Stops health checks and cleans up resources.
   */
  stop(): void {
    this.rpcFallback.stop();
    logger.info('ConnectionManager stopped');
  }

  private decodeBase58(encoded: string): Uint8Array {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const ALPHABET_MAP = new Map<string, number>();
    for (let i = 0; i < ALPHABET.length; i++) {
      ALPHABET_MAP.set(ALPHABET[i], i);
    }

    let bytes = [0];
    for (const char of encoded) {
      const value = ALPHABET_MAP.get(char);
      if (value === undefined) {
        throw new Error(`Invalid base58 character: ${char}`);
      }
      let carry = value;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }

    for (const char of encoded) {
      if (char === '1') {
        bytes.push(0);
      } else {
        break;
      }
    }

    return Uint8Array.from(bytes.reverse());
  }
}
