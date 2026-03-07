import { PublicKey } from '@solana/web3.js';

/**
 * Validates a Solana base58 address.
 * @param address - Address string to validate
 * @returns True if the address is a valid Solana public key
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    const pubkey = new PublicKey(address);
    return PublicKey.isOnCurve(pubkey.toBytes());
  } catch {
    return false;
  }
}

/**
 * Validates that a string is a valid Solana public key (not necessarily on curve).
 * @param address - Address string to validate
 * @returns True if parseable as a PublicKey
 */
export function isValidPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a transaction signature format.
 * @param signature - Transaction signature to validate
 * @returns True if the signature has valid format
 */
export function isValidTxSignature(signature: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(signature);
}

/**
 * Validates that a number is a positive finite value.
 * @param value - Number to validate
 * @returns True if the value is positive and finite
 */
export function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Validates slippage basis points within acceptable range.
 * @param bps - Basis points value
 * @returns True if bps is within 1-5000 range (0.01% to 50%)
 */
export function isValidSlippageBps(bps: number): boolean {
  return Number.isInteger(bps) && bps >= 1 && bps <= 5000;
}
