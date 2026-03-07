import BN from 'bn.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Converts lamports to SOL.
 * @param lamports - Amount in lamports
 * @returns Amount in SOL
 */
export function lamportsToSol(lamports: number | BN): number {
  if (BN.isBN(lamports)) {
    return lamports.toNumber() / LAMPORTS_PER_SOL;
  }
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Converts SOL to lamports.
 * @param sol - Amount in SOL
 * @returns Amount in lamports as BN
 */
export function solToLamports(sol: number): BN {
  return new BN(Math.round(sol * LAMPORTS_PER_SOL));
}

/**
 * Formats a token amount accounting for decimals.
 * @param rawAmount - Raw token amount (no decimal adjustment)
 * @param decimals - Token decimals
 * @returns Human-readable formatted amount string
 */
export function formatTokenAmount(rawAmount: number | string | BN, decimals: number): string {
  let value: number;
  if (BN.isBN(rawAmount)) {
    value = rawAmount.toNumber();
  } else if (typeof rawAmount === 'string') {
    value = parseFloat(rawAmount);
  } else {
    value = rawAmount;
  }

  const adjusted = value / Math.pow(10, decimals);

  if (adjusted >= 1_000_000) {
    return `${(adjusted / 1_000_000).toFixed(2)}M`;
  }
  if (adjusted >= 1_000) {
    return `${(adjusted / 1_000).toFixed(2)}K`;
  }
  return adjusted.toFixed(decimals > 4 ? 4 : decimals);
}

/**
 * Shortens a Solana address for display.
 * @param address - Full base58 address
 * @param chars - Number of characters to keep at start and end
 * @returns Shortened address (e.g. "Abcd...wxyz")
 */
export function shortenAddress(address: string, chars: number = 4): string {
  if (address.length <= chars * 2 + 3) {
    return address;
  }
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
