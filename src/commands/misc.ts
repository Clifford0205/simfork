import { loadConfig, saveConfig, tokenAliases } from "../config.ts";
import { c, fail, info, log, ok } from "../log.ts";
import { asAddress } from "../rpc.ts";
import { connect, type TargetOpts } from "../target.ts";
import { CHAINS, chainName, resolveChainId } from "../tokens.ts";

/** sim tokens [--chain id] — list resolvable aliases; sim tokens add <alias> <address> --chain id */
export async function tokensListCommand(
  opts: TargetOpts & { chain?: string },
): Promise<void> {
  const config = loadConfig();
  let chainId: number;
  if (opts.chain) {
    chainId = Number(opts.chain);
  } else {
    ({ chainId } = await connect(opts));
  }
  log(c.bold(`Tokens on ${chainName(chainId)} (${chainId}):`));
  const aliases = tokenAliases(config, chainId);
  for (const [alias, address] of Object.entries(aliases).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    log(`  ${alias.padEnd(10)} ${address}`);
  }
  if (!Object.keys(aliases).length)
    info(
      "No aliases known for this chain — add one: sim tokens add <alias> <address> --chain <id>",
    );
}

export function tokensAddCommand(
  alias: string,
  address: string,
  opts: { chain?: string },
): void {
  if (!opts.chain) fail("Missing --chain <id>");
  asAddress(address, "token");
  const config = loadConfig();
  config.tokens ??= {};
  config.tokens[opts.chain] ??= {};
  config.tokens[opts.chain]![alias.toLowerCase()] = address;
  saveConfig(config);
  ok(`Alias ${c.bold(alias)} → ${address} saved for chain ${opts.chain}`);
}

export function chainsCommand(): void {
  const config = loadConfig();
  log(c.bold("Known chains:"));
  for (const chain of CHAINS) {
    const configured =
      config.chains?.[String(chain.id)]?.rpcUrl ??
      process.env[`NETWORK_${chain.id}_RPC_URL`];
    const forkBlock = config.chains?.[String(chain.id)]?.forkBlock;
    log(
      `  ${String(chain.id).padEnd(7)} ${chain.name.padEnd(10)} aliases: ${chain.aliases.join(", ").padEnd(24)} ` +
        (configured ? c.green("rpc ✔") : c.dim("rpc —")) +
        (forkBlock ? c.dim(`  pin@${forkBlock}`) : ""),
    );
  }
  const extra = Object.keys(config.chains ?? {}).filter(
    (id) => !CHAINS.some((chain) => String(chain.id) === id),
  );
  for (const id of extra) {
    log(`  ${id.padEnd(7)} ${"custom".padEnd(10)} ${c.green("rpc ✔")}`);
  }
}

/** sim chains add <chain> --rpc <url> [--block n] — configure an upstream without editing YAML. */
export function chainsAddCommand(
  chainInput: string,
  opts: { rpc?: string; block?: string },
): void {
  const chainId = resolveChainId(chainInput);
  if (!chainId)
    fail(
      `Unknown chain "${chainInput}" — pass a numeric chain id for chains simfork does not know by name.`,
    );
  if (!opts.rpc) fail("Missing --rpc <url>");
  try {
    new URL(opts.rpc);
  } catch {
    fail(`Invalid RPC URL: ${opts.rpc}`);
  }

  const config = loadConfig();
  config.chains ??= {};
  config.chains[String(chainId)] = {
    rpcUrl: opts.rpc,
    ...(opts.block
      ? { forkBlock: Number(opts.block) }
      : config.chains[String(chainId)]?.forkBlock !== undefined
        ? { forkBlock: config.chains[String(chainId)]!.forkBlock }
        : {}),
  };
  saveConfig(config);
  ok(
    `Chain ${c.bold(`${chainName(chainId)} (${chainId})`)} configured${opts.block ? `, pinned at block ${opts.block}` : ""}`,
  );
  if (!opts.block) {
    info(
      "No fork block pinned — add --block <n> so anvil can reuse its disk cache and restart instantly.",
    );
  }
  info(`Start it: sim start ${chainInput}`);
}

/** sim chains rm <chain> */
export function chainsRemoveCommand(chainInput: string): void {
  const chainId = resolveChainId(chainInput);
  if (!chainId) fail(`Unknown chain: ${chainInput}`);
  const config = loadConfig();
  if (!config.chains?.[String(chainId)])
    fail(`Chain ${chainId} is not configured.`);
  delete config.chains[String(chainId)];
  saveConfig(config);
  ok(`Removed chain ${chainId} from config`);
}
