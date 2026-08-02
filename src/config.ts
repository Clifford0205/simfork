import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';
import { CONFIG_PATH, ensureDirs } from './paths.ts';
import { BUILTIN_TOKENS } from './tokens.ts';

export interface ChainConfig {
  rpcUrl?: string;
  forkBlock?: number;
}

export interface SimforkConfig {
  defaultChain?: number;
  defaultPort?: number;
  /** Path to the frontend-suite monorepo, used by `sim ewe`. */
  eweRepo?: string;
  /** Addresses funded with ETH every time a fork starts. */
  genesisAccounts?: string[];
  /** ETH amount (in ether) given to each genesis account. */
  genesisEth?: number;
  chains?: Record<string, ChainConfig>;
  /** Per-chain token aliases merged over the built-in registry. */
  tokens?: Record<string, Record<string, string>>;
}

export function loadConfig(): SimforkConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  const parsed = YAML.parse(readFileSync(CONFIG_PATH, 'utf8'));
  return (parsed ?? {}) as SimforkConfig;
}

export function saveConfig(config: SimforkConfig): void {
  ensureDirs();
  writeFileSync(CONFIG_PATH, YAML.stringify(config));
}

/** RPC URL for forking a chain: config file first, then NETWORK_<id>_RPC_URL env. */
export function upstreamRpcUrl(config: SimforkConfig, chainId: number): string | undefined {
  return config.chains?.[String(chainId)]?.rpcUrl ?? process.env[`NETWORK_${chainId}_RPC_URL`];
}

/** Pinned fork block: config file first, then NETWORK_<id>_FORK_BLOCK env. */
export function pinnedForkBlock(config: SimforkConfig, chainId: number): number | undefined {
  const fromConfig = config.chains?.[String(chainId)]?.forkBlock;
  if (fromConfig !== undefined) return Number(fromConfig);
  const fromEnv = process.env[`NETWORK_${chainId}_FORK_BLOCK`];
  return fromEnv ? Number(fromEnv) : undefined;
}

/** Merge built-in and user token aliases for a chain (user wins). */
export function tokenAliases(config: SimforkConfig, chainId: number): Record<string, string> {
  const user = config.tokens?.[String(chainId)] ?? {};
  const lowered: Record<string, string> = {};
  for (const [alias, address] of Object.entries(user)) lowered[alias.toLowerCase()] = address;
  return { ...(BUILTIN_TOKENS[chainId] ?? {}), ...lowered };
}

export function resolveToken(config: SimforkConfig, chainId: number, input: string): string | undefined {
  if (/^0x[a-fA-F0-9]{40}$/.test(input)) return input;
  return tokenAliases(config, chainId)[input.toLowerCase()];
}
