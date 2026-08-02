import { formatUnits, parseUnits } from 'viem';

/**
 * Parse a user-supplied amount.
 * - `raw` (or a 0x-prefixed value) → interpreted as base units, no scaling
 * - otherwise → decimal string scaled by `decimals` (e.g. "1.5" USDC → 1500000)
 * - suffixes k / m / b are supported for human amounts ("10k" → 10000)
 */
export function parseAmount(input: string, decimals: number, raw = false): bigint {
  const trimmed = input.trim();
  if (raw || trimmed.startsWith('0x')) return BigInt(trimmed);

  const match = trimmed.match(/^([\d_]+(?:\.\d+)?)([kmb])?$/i);
  if (!match) throw new Error(`Cannot parse amount: ${input}`);
  const [, numPart, suffix] = match;
  let value = parseUnits(numPart!.replaceAll('_', ''), decimals);
  if (suffix) {
    const mult = { k: 1_000n, m: 1_000_000n, b: 1_000_000_000n }[suffix.toLowerCase() as 'k' | 'm' | 'b'];
    value *= mult;
  }
  return value;
}

export function formatAmount(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}

/**
 * Parse a time offset like "+1d", "+2h30m" is NOT supported — single unit only:
 * "+30s", "+10m", "+2h", "+1d", "+1w", or a bare number of seconds.
 * Returns seconds.
 */
export function parseDuration(input: string): number {
  const match = input.match(/^\+?(\d+)([smhdw]?)$/i);
  if (!match) throw new Error(`Cannot parse duration: ${input} (use e.g. +30s, +10m, +2h, +1d, +1w)`);
  const [, num, unit] = match;
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[unit!.toLowerCase() as '' | 's' | 'm' | 'h' | 'd' | 'w'];
  return Number(num) * mult;
}
