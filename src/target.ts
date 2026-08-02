import { erc20Abi, type Address } from "viem";
import { liveInstances } from "./proc.ts";
import { chainIdOf, isRpcUp, makeClients, type Clients } from "./rpc.ts";
import { fail } from "./log.ts";
import { chainName } from "./tokens.ts";

export interface TargetOpts {
  rpc?: string;
  port?: string | number;
}

/**
 * Which local node should an ops command talk to?
 * --rpc wins, then --port (localhost), then the single running instance.
 * Multiple running forks without an explicit target is ambiguous — fail
 * loudly instead of silently guessing 8545.
 */
export function resolveRpcUrl(opts: TargetOpts): string {
  if (opts.rpc) return opts.rpc;
  if (opts.port) return `http://localhost:${opts.port}`;
  const live = liveInstances();
  if (live.length === 1) return live[0]!.rpcUrl;
  if (live.length > 1) {
    const listing = live
      .map((i) => `${i.port} (${chainName(i.chainId)})`)
      .join(", ");
    fail(`Multiple forks running: ${listing}. Target one with -p <port>.`);
  }
  return "http://localhost:8545";
}

export async function connect(
  opts: TargetOpts,
): Promise<{ clients: Clients; chainId: number }> {
  const rpcUrl = resolveRpcUrl(opts);
  if (!(await isRpcUp(rpcUrl))) {
    fail(
      `No RPC responding at ${rpcUrl}. Start a fork first: sim start <chain>`,
    );
  }
  return { clients: makeClients(rpcUrl), chainId: await chainIdOf(rpcUrl) };
}

export interface TokenMeta {
  symbol: string;
  decimals: number;
}

export async function tokenMeta(
  clients: Clients,
  token: Address,
): Promise<TokenMeta> {
  const [symbol, decimals] = await Promise.all([
    clients.pub
      .readContract({ address: token, abi: erc20Abi, functionName: "symbol" })
      .catch(() => "???"),
    clients.pub
      .readContract({ address: token, abi: erc20Abi, functionName: "decimals" })
      .catch(() => 18),
  ]);
  return { symbol, decimals };
}
