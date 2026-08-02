import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { parseEther, numberToHex } from "viem";
import {
  genesisAccounts,
  genesisEth,
  genesisTokens,
  loadConfig,
  pinnedForkBlock,
  resolveToken,
  upstreamRpcUrl,
} from "../config.ts";
import { parseAmount } from "../amount.ts";
import { c, fail, info, ok, warn } from "../log.ts";
import { ensureDirs } from "../paths.ts";
import {
  killPort,
  liveInstances,
  logFileFor,
  pidsOnPort,
  saveInstance,
} from "../proc.ts";
import { asAddress, isRpcUp, makeClients, rpcRaw } from "../rpc.ts";
import { setTokenBalance } from "../slot.ts";
import { tokenMeta } from "../target.ts";
import { chainName, resolveChainId } from "../tokens.ts";

export interface StartOpts {
  port?: string;
  block?: string;
  trace?: boolean;
  foreground?: boolean;
  forkUrl?: string;
  anvilArgs?: string[];
}

const READY_TIMEOUT_MS = 180_000;

/**
 * Pick the port to fork on.
 * - Explicit -p: use it as-is, killing whatever occupies it (old behaviour).
 * - Otherwise scan upward from defaultPort: reuse the port of a running fork
 *   of the SAME chain (restart), skip ports held by other chains or foreign
 *   processes, and settle on the first free one.
 */
async function resolvePort(
  opts: StartOpts,
  config: ReturnType<typeof loadConfig>,
  chainId: number,
): Promise<number> {
  if (opts.port) {
    const port = Number(opts.port);
    const killed = killPort(port);
    if (killed.length) {
      info(`Freed port ${port} (killed pid ${killed.join(", ")})`);
      await Bun.sleep(500);
    }
    return port;
  }

  const base = Number(config.defaultPort ?? 8545);
  const live = liveInstances();
  for (let port = base; port < base + 100; port++) {
    const running = live.find((instance) => instance.port === port);
    if (running) {
      if (running.chainId === chainId) {
        // Same chain already forked here — restart it on the same port.
        const killed = killPort(port);
        if (killed.length) {
          info(
            `Restarting ${chainName(chainId)} fork on port ${port} (killed pid ${killed.join(", ")})`,
          );
          await Bun.sleep(500);
        }
        return port;
      }
      info(
        `Port ${port} busy — ${chainName(running.chainId)} (${running.chainId}) fork running there, trying ${port + 1}`,
      );
      continue;
    }
    if (pidsOnPort(port).length) {
      info(`Port ${port} busy (not a simfork instance), trying ${port + 1}`);
      continue;
    }
    return port;
  }
  fail(`No free port found in ${base}–${base + 99}.`);
}

export async function startCommand(
  chainInput: string | undefined,
  opts: StartOpts,
): Promise<void> {
  ensureDirs();
  const config = loadConfig();

  const chainRef = chainInput ?? String(config.defaultChain ?? 42161);
  const chainId = resolveChainId(chainRef);
  if (!chainId) fail(`Unknown chain: ${chainRef}`);

  const upstream = opts.forkUrl ?? upstreamRpcUrl(config, chainId);
  if (!upstream) {
    fail(
      `No upstream RPC URL for chain ${chainId}. ` +
        `Add it via "sim init" / config.yml (chains.${chainId}.rpcUrl) or NETWORK_${chainId}_RPC_URL env, or pass --fork-url.`,
    );
  }

  const port = await resolvePort(opts, config, chainId);
  const forkBlock = opts.block
    ? Number(opts.block)
    : pinnedForkBlock(config, chainId);
  const rpcUrl = `http://localhost:${port}`;

  const args = ["--fork-url", upstream, "-p", String(port)];
  if (forkBlock) {
    args.push("--fork-block-number", String(forkBlock));
  } else {
    warn(
      "No fork block pinned — anvil cannot reuse its on-disk RPC cache and every start refetches state.",
    );
    warn(
      `Pin one with -b <block>, config chains.${chainId}.forkBlock, or NETWORK_${chainId}_FORK_BLOCK.`,
    );
  }
  if (opts.trace) args.push("--steps-tracing");
  if (opts.anvilArgs?.length) args.push(...opts.anvilArgs);

  const logFile = logFileFor(port);
  const logFd = openSync(logFile, "a");
  info(
    `Starting anvil fork of ${c.bold(chainName(chainId))} (${chainId}) on port ${port}${forkBlock ? ` @ block ${forkBlock}` : ""}`,
  );

  try {
    const upstreamLatest = Number(
      (await rpcRaw(upstream, "eth_blockNumber")) as string,
    );
    const behind = forkBlock ? upstreamLatest - forkBlock : undefined;
    info(
      `Upstream latest block: ${upstreamLatest}` +
        (behind !== undefined
          ? ` — pinned block is ${behind} block(s) behind`
          : " (forking here)"),
    );
  } catch {
    // Upstream unreachable or slow — anvil will surface the real error below.
  }

  const child = spawn("anvil", args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  const pid = child.pid;
  if (!pid)
    fail(
      "Failed to spawn anvil — is foundry installed? (curl -L https://foundry.paradigm.xyz | bash)",
    );

  // Wait for the RPC to come up, bailing out if anvil died.
  const startedAt = Date.now();
  while (!(await isRpcUp(rpcUrl))) {
    try {
      process.kill(pid, 0);
    } catch {
      fail(`anvil exited before the RPC came up. Check the log: ${logFile}`);
    }
    if (Date.now() - startedAt > READY_TIMEOUT_MS) {
      process.kill(pid, "SIGTERM");
      fail(
        `Timed out after ${READY_TIMEOUT_MS / 1000}s waiting for the fork on port ${port}.`,
      );
    }
    await Bun.sleep(1500);
  }

  // Post-start setup, mirroring the original fork_tenderly.sh behaviour.
  await rpcRaw(rpcUrl, "anvil_setChainId", [chainId]);
  await rpcRaw(rpcUrl, "anvil_autoImpersonateAccount", [true]);

  const accounts = genesisAccounts(config);
  const ethPerAccount = genesisEth(config);
  const ethHex = numberToHex(parseEther(String(ethPerAccount)));
  for (const account of accounts) {
    await rpcRaw(rpcUrl, "anvil_setBalance", [account, ethHex]);
  }
  if (accounts.length) {
    info(
      `Funded ${accounts.length} genesis account(s) with ${ethPerAccount} ETH`,
    );
  }

  // ERC20 genesis funding: mint each configured token to every genesis account.
  const tokenEntries = Object.entries(genesisTokens(config));
  if (tokenEntries.length && accounts.length) {
    const clients = makeClients(rpcUrl);
    for (const [alias, rawAmount] of tokenEntries) {
      const tokenAddr = resolveToken(config, chainId, alias);
      if (!tokenAddr) {
        warn(
          `genesisTokens: no "${alias}" alias on chain ${chainId} — skipped`,
        );
        continue;
      }
      try {
        const token = asAddress(tokenAddr, "token");
        const { symbol, decimals } = await tokenMeta(clients, token);
        const amount = parseAmount(String(rawAmount), decimals);
        for (const account of accounts) {
          await setTokenBalance(
            clients,
            chainId,
            token,
            asAddress(account),
            amount,
          );
        }
        info(
          `Funded ${accounts.length} genesis account(s) with ${rawAmount} ${symbol}`,
        );
      } catch (err) {
        warn(
          `genesisTokens: funding "${alias}" failed — ${(err as Error).message}`,
        );
      }
    }
  }

  const upstreamHost = (() => {
    try {
      return new URL(upstream).host;
    } catch {
      return undefined;
    }
  })();

  saveInstance({
    port,
    chainId,
    pid,
    rpcUrl,
    forkBlock,
    upstreamHost,
    startedAt: new Date().toISOString(),
    logFile,
  });

  const block = Number((await rpcRaw(rpcUrl, "eth_blockNumber")) as string);
  ok(
    `Fork ready: ${c.bold(rpcUrl)} — chain ${chainId} (${chainName(chainId)}), block ${block}, pid ${pid}`,
  );
  info(
    `Logs: sim logs ${port === 8545 ? "" : port} — stop: sim stop ${port === 8545 ? "" : port}`,
  );

  if (opts.foreground) {
    info("Foreground mode — streaming anvil log, Ctrl-C stops the fork.");
    const stop = () => {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    spawnSync("tail", ["-f", logFile], { stdio: "inherit" });
  }
}
