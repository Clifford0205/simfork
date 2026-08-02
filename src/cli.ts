#!/usr/bin/env bun
import { Command } from "commander";
import { fail } from "./log.ts";
import { balanceCommand } from "./commands/balance.ts";
import { eweCommand } from "./commands/ewe.ts";
import { fundCommand } from "./commands/fund.ts";
import { initCommand } from "./commands/init.ts";
import {
  logsCommand,
  statusCommand,
  stopCommand,
} from "./commands/lifecycle.ts";
import {
  chainsAddCommand,
  chainsCommand,
  chainsRemoveCommand,
  tokensAddCommand,
  tokensListCommand,
} from "./commands/misc.ts";
import { startCommand } from "./commands/start.ts";
import {
  mineCommand,
  revertCommand,
  snapshotCommand,
  timeCommand,
} from "./commands/state.ts";
import { callCommand, rpcCommand, sendCommand } from "./commands/tx.ts";

const program = new Command();

program
  .name("sim")
  .description(
    "Local EVM fork simulator — anvil wrapper with painless funding, time travel and snapshots",
  )
  .version("0.1.0")
  .option(
    "-u, --rpc <url>",
    "target RPC URL of a running fork (default: auto-detect)",
  )
  .option(
    "-p, --port <port>",
    "target port on localhost (alternative to --rpc)",
  );

function target() {
  const opts = program.opts<{ rpc?: string; port?: string }>();
  return { rpc: opts.rpc, port: opts.port };
}

program
  .command("init")
  .description(
    "create ~/.simfork/config.yml (auto-imports RPC URLs from the frontend-suite monorepo)",
  )
  .option(
    "--from <envfile>",
    "dotenv file to import NETWORK_<id>_RPC_URL / _FORK_BLOCK from",
  )
  .option("--ewe-repo <path>", "path to the frontend-suite monorepo")
  .action((opts) => initCommand(opts));

program
  .command("start [chain] [anvilArgs...]")
  .description(
    "start a forked chain (chain id or name: arb, base, eth, op, polygon, bsc)",
  )
  .option(
    "-b, --block <number>",
    "pin the fork to a block (enables anvil RPC cache reuse)",
  )
  .option("-t, --trace", "enable --steps-tracing (heavy)")
  .option(
    "-f, --foreground",
    "stay attached, stream the log, Ctrl-C stops the fork",
  )
  .option("--fork-url <url>", "override the upstream RPC URL")
  .addHelpText(
    "after",
    '\nExtra anvil flags can be passed after "--":\n  sim start arb -- --block-time 2',
  )
  .action((chain, anvilArgs, opts) =>
    startCommand(chain, {
      ...opts,
      port: program.opts().port,
      anvilArgs,
    }).catch((err) => fail(String(err))),
  );

program
  .command("stop [port]")
  .description("stop a running fork (default: the only one running)")
  .option("-a, --all", "stop every recorded fork")
  .action((port, opts) => stopCommand(port, opts));

program
  .command("status")
  .description("list running forks")
  .action(() => statusCommand().catch((err) => fail(String(err))));

program
  .command("logs [port]")
  .description("show anvil logs")
  .option("-f, --follow", "tail -f")
  .option("-n, --lines <n>", "number of lines", "50")
  .action((port, opts) => logsCommand(port, opts));

program
  .command("fund <token> <receiver> <amount>")
  .description(
    'fund native coin or any ERC20 (alias or address). Amounts are human units ("1.5", "10k")',
  )
  .option("--raw", "treat amount as raw base units (wei)")
  .option("--set", "set the balance to the amount instead of adding")
  .option(
    "--whale <address>",
    "fund via impersonated whale transfer instead of storage write",
  )
  .action((token, receiver, amount, opts) =>
    fundCommand(token, receiver, amount, { ...opts, ...target() }).catch(
      (err) => fail(String(err)),
    ),
  );

program
  .command("balance <address> [tokens...]")
  .description(
    "show native + token balances (no tokens → sweep all known aliases)",
  )
  .action((address, tokens) =>
    balanceCommand(address, tokens, target()).catch((err) => fail(String(err))),
  );

program
  .command("send <to> <sig> [args...]")
  .description(
    'send an impersonated tx: sim send 0xToken "transfer(address,uint256)" 0xabc 1000 --from 0xWhale',
  )
  .requiredOption("--from <address>", "sender (auto-impersonated)")
  .option("--value <eth>", "ETH value to attach")
  .action((to, sig, args, opts) =>
    sendCommand(to, sig, args, { ...opts, ...target() }).catch((err) =>
      fail(String(err)),
    ),
  );

program
  .command("call <to> <sig> [args...]")
  .description(
    'read-only call: sim call 0xToken "balanceOf(address)(uint256)" 0xabc',
  )
  .action((to, sig, args) =>
    callCommand(to, sig, args, target()).catch((err) => fail(String(err))),
  );

program
  .command("snapshot")
  .description("take an EVM snapshot")
  .option("-m, --name <name>", "save under a name for sim revert <name>")
  .action((opts) =>
    snapshotCommand({ ...opts, ...target() }).catch((err) => fail(String(err))),
  );

program
  .command("revert <ref>")
  .description("revert to a snapshot id (0x…) or saved name")
  .action((ref) =>
    revertCommand(ref, target()).catch((err) => fail(String(err))),
  );

program
  .command("time <spec>")
  .description(
    "advance block time: sim time +1d | sim time +2h | sim time 1736650000",
  )
  .action((spec) =>
    timeCommand(spec, target()).catch((err) => fail(String(err))),
  );

program
  .command("mine [count]")
  .description("mine blocks")
  .option("-i, --interval <seconds>", "seconds between mined blocks")
  .action((count, opts) =>
    mineCommand(count, { ...opts, ...target() }).catch((err) =>
      fail(String(err)),
    ),
  );

program
  .command("rpc <method> [params...]")
  .description(
    "raw JSON-RPC: sim rpc anvil_setBalance 0xabc… 0xde0b6b3a7640000",
  )
  .action((method, params) =>
    rpcCommand(method, params, target()).catch((err) => fail(String(err))),
  );

const tokens = program.command("tokens").description("token alias registry");
tokens
  .command("list", { isDefault: true })
  .description("list aliases for the current (or --chain) chain")
  .option("-c, --chain <id>", "chain id (skips RPC auto-detect)")
  .action((opts) =>
    tokensListCommand({ ...opts, ...target() }).catch((err) =>
      fail(String(err)),
    ),
  );
tokens
  .command("add <alias> <address>")
  .description("save a custom alias")
  .requiredOption("-c, --chain <id>", "chain id")
  .action((alias, address, opts) => tokensAddCommand(alias, address, opts));

const chains = program
  .command("chains")
  .description("chain registry: list, add or remove upstream RPC settings");
chains
  .command("list", { isDefault: true })
  .description("list known chains and whether an upstream RPC is configured")
  .action(() => chainsCommand());
chains
  .command("add <chain> <rpcUrl>")
  .description(
    "configure an upstream RPC: sim chains add arb https://… -b 483630160",
  )
  .option(
    "-b, --block <number>",
    "pin the fork block (enables anvil disk cache)",
  )
  .action((chain, rpcUrl, opts) =>
    chainsAddCommand(chain, { ...opts, rpc: rpcUrl }),
  );
chains
  .command("rm <chain>")
  .description("remove a chain's saved RPC settings")
  .action((chain) => chainsRemoveCommand(chain));

program
  .command("ewe [flow] [args...]")
  .description(
    "run a frontend-suite simulation flow (rewards, dca, fix-reinvest, aerodrome-prep)",
  )
  .allowUnknownOption(true)
  .helpOption(false)
  .action((flow, args) => eweCommand(flow, args));

program.parseAsync().catch((err) => fail(String(err)));
