import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, saveConfig, type SimforkConfig } from "../config.ts";
import { CONFIG_PATH } from "../paths.ts";
import { c, info, ok, warn } from "../log.ts";

const DEFAULT_GENESIS_ACCOUNTS = [
  "0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369",
  "0xc185774a25936b17049a98fbaf14d9f2d7432771",
  "0x489ee077994B6658eAfA855C308275EAd8097C4A",
  "0x5a6ae290a438fd1461043339134fb3abe842a08c",
];

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/…`;
  } catch {
    return "<invalid url>";
  }
}

/** Parse NETWORK_<id>_RPC_URL / NETWORK_<id>_FORK_BLOCK lines from a dotenv file. */
function importEnvFile(path: string, config: SimforkConfig): number {
  const content = readFileSync(path, "utf8");
  let imported = 0;
  for (const line of content.split("\n")) {
    const match = line.match(/^NETWORK_(\d+)_(RPC_URL|FORK_BLOCK)=(.*)$/);
    if (!match) continue;
    const [, chainId, kind, rawValue] = match;
    const value = rawValue!.trim().replace(/^['"]|['"]$/g, "");
    if (!value) continue;
    config.chains ??= {};
    config.chains[chainId!] ??= {};
    if (kind === "RPC_URL") {
      config.chains[chainId!]!.rpcUrl = value;
      info(`chain ${chainId}: rpcUrl ${maskUrl(value)}`);
    } else {
      config.chains[chainId!]!.forkBlock = Number(value);
      info(`chain ${chainId}: forkBlock ${value}`);
    }
    imported++;
  }
  return imported;
}

export interface InitOpts {
  from?: string;
  eweRepo?: string;
}

/**
 * sim init [--from <envfile>] [--ewe-repo <path>]
 * Creates/updates ~/.simfork/config.yml, importing RPC URLs from the
 * monorepo's .env.local when it can find one.
 */
export function initCommand(opts: InitOpts): void {
  const config = loadConfig();

  const repoCandidates = [
    opts.eweRepo,
    config.eweRepo,
    process.env.EWE_REPO,
    join(process.env.HOME ?? "", "Desktop/ewe/frontend-suite"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const repo = repoCandidates.find((candidate) =>
    existsSync(join(candidate, "apps/simulation-testnet")),
  );
  if (repo) {
    config.eweRepo = repo;
    info(`Found frontend-suite monorepo (optional, powers "sim ewe"): ${repo}`);
  } else {
    info(
      'No frontend-suite monorepo nearby — that is fine, only the optional "sim ewe" flows need it.',
    );
  }

  const envFile =
    opts.from ??
    (repo ? join(repo, "apps/simulation-testnet/.env.local") : undefined);
  if (envFile && existsSync(envFile)) {
    info(`Importing RPC settings from ${envFile}`);
    const count = importEnvFile(envFile, config);
    ok(`Imported ${count} setting(s)`);
  } else if (opts.from) {
    warn(`Env file not found: ${opts.from}`);
  }

  config.defaultChain ??= 42161;
  config.defaultPort ??= 8545;
  config.genesisEth ??= 1000;
  config.genesisAccounts ??= DEFAULT_GENESIS_ACCOUNTS;

  saveConfig(config);
  ok(`Config written to ${c.bold(CONFIG_PATH)}`);
  if (Object.keys(config.chains ?? {}).length) {
    info("Next: sim start arb   (then: sim fund usdt 0x… 1000)");
  } else {
    info("Next: point a chain at an upstream RPC, then start it:");
    info(
      "  sim chains add arb --rpc https://arb-mainnet.g.alchemy.com/v2/KEY --block <n>",
    );
    info("  sim start arb");
  }
}
