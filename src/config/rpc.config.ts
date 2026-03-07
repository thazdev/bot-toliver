import type { SolanaConfig } from '../types/config.types.js';

export function loadRpcConfig(): SolanaConfig {
  const heliusRpcUrl = process.env.HELIUS_RPC_URL;
  const heliusWsUrl = process.env.HELIUS_WS_URL;
  const walletPrivateKey = process.env.WALLET_PRIVATE_KEY;

  if (!heliusRpcUrl) {
    throw new Error('HELIUS_RPC_URL is required');
  }
  if (!heliusWsUrl) {
    throw new Error('HELIUS_WS_URL is required');
  }
  if (!walletPrivateKey) {
    throw new Error('WALLET_PRIVATE_KEY is required');
  }

  return {
    heliusRpcUrl,
    heliusWsUrl,
    fallbackRpcUrl: process.env.FALLBACK_RPC_URL ?? heliusRpcUrl,
    walletPrivateKey,
  };
}
