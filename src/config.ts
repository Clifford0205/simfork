import { existsSync, readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";
import { CONFIG_PATH, ensureDirs } from "./paths.ts";
import { BUILTIN_TOKENS } from "./tokens.ts";

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
  /**
   * ERC20s minted to every genesis account on start, by alias or address.
   * Values are whole-token amounts (decimals auto-detected), set absolutely.
   * Example: { usdt: 99999, usdc: 99999 }
   */
  genesisTokens?: Record<string, number | string>;
  chains?: Record<string, ChainConfig>;
  /** Per-chain token aliases merged over the built-in registry. */
  tokens?: Record<string, Record<string, string>>;
}

export function loadConfig(): SimforkConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  const parsed = YAML.parse(readFileSync(CONFIG_PATH, "utf8"));
  return (parsed ?? {}) as SimforkConfig;
}

export function saveConfig(config: SimforkConfig): void {
  ensureDirs();
  writeFileSync(CONFIG_PATH, YAML.stringify(config));
}

/** RPC URL for forking a chain: config file first, then NETWORK_<id>_RPC_URL env. */
export function upstreamRpcUrl(
  config: SimforkConfig,
  chainId: number,
): string | undefined {
  return (
    config.chains?.[String(chainId)]?.rpcUrl ??
    process.env[`NETWORK_${chainId}_RPC_URL`]
  );
}

/** Pinned fork block: config file first, then NETWORK_<id>_FORK_BLOCK env. */
export function pinnedForkBlock(
  config: SimforkConfig,
  chainId: number,
): number | undefined {
  const fromConfig = config.chains?.[String(chainId)]?.forkBlock;
  if (fromConfig !== undefined) return Number(fromConfig);
  const fromEnv = process.env[`NETWORK_${chainId}_FORK_BLOCK`];
  return fromEnv ? Number(fromEnv) : undefined;
}

/** Genesis accounts: config file first, then GENESIS_ACCOUNTS env (comma-separated). */
export function genesisAccounts(config: SimforkConfig): string[] {
  if (config.genesisAccounts?.length) return config.genesisAccounts;
  const fromEnv = process.env.GENESIS_ACCOUNTS;
  if (!fromEnv) return [];
  return fromEnv
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

/** ETH per genesis account: config file first, then GENESIS_ETH env, then 1000. */
export function genesisEth(config: SimforkConfig): number {
  if (config.genesisEth !== undefined) return Number(config.genesisEth);
  const fromEnv = process.env.GENESIS_ETH;
  return fromEnv ? Number(fromEnv) : 1000;
}

/**
 * ERC20s minted to genesis accounts: config file first, then GENESIS_TOKENS
 * env in "alias:amount,alias:amount" form (e.g. "usdt:99999,usdc:99999").
 */
export function genesisTokens(
  config: SimforkConfig,
): Record<string, number | string> {
  if (config.genesisTokens) return config.genesisTokens;
  const fromEnv = process.env.GENESIS_TOKENS;
  if (!fromEnv) return {};
  const tokens: Record<string, string> = {};
  for (const pair of fromEnv.split(",")) {
    const [alias, amount] = pair.split(":").map((part) => part.trim());
    if (alias && amount) tokens[alias] = amount;
  }
  return tokens;
}

/** Merge built-in and user token aliases for a chain (user wins). */
export function tokenAliases(
  config: SimforkConfig,
  chainId: number,
): Record<string, string> {
  const user = config.tokens?.[String(chainId)] ?? {};
  const lowered: Record<string, string> = {};
  for (const [alias, address] of Object.entries(user))
    lowered[alias.toLowerCase()] = address;
  return { ...(BUILTIN_TOKENS[chainId] ?? {}), ...lowered };
}

export function resolveToken(
  config: SimforkConfig,
  chainId: number,
  input: string,
): string | undefined {
  if (/^0x[a-fA-F0-9]{40}$/.test(input)) return input;
  return tokenAliases(config, chainId)[input.toLowerCase()];
}
