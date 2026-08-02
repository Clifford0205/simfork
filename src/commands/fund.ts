import { erc20Abi, formatEther, parseEther } from "viem";
import { loadConfig, resolveToken } from "../config.ts";
import { formatAmount, parseAmount } from "../amount.ts";
import { c, fail, info, ok } from "../log.ts";
import { asAddress, rpcRaw } from "../rpc.ts";
import { setTokenBalance } from "../slot.ts";
import { connect, tokenMeta, type TargetOpts } from "../target.ts";

export interface FundOpts extends TargetOpts {
  raw?: boolean;
  set?: boolean;
  whale?: string;
}

/**
 * sim fund <token|eth> <receiver> <amount>
 * - eth        → anvil_setBalance (additive by default)
 * - erc20      → storage-slot write (additive by default), or --whale transfer
 */
export async function fundCommand(
  tokenInput: string,
  receiverInput: string,
  amountInput: string,
  opts: FundOpts,
): Promise<void> {
  const { clients, chainId } = await connect(opts);
  const receiver = asAddress(receiverInput, "receiver");

  const NATIVE = ["eth", "native", "bnb", "matic", "pol"];
  if (NATIVE.includes(tokenInput.toLowerCase())) {
    const amount = opts.raw ? BigInt(amountInput) : parseEther(amountInput);
    const current = await clients.pub.getBalance({ address: receiver });
    const next = opts.set ? amount : current + amount;
    await rpcRaw(clients.rpcUrl, "anvil_setBalance", [
      receiver,
      `0x${next.toString(16)}`,
    ]);
    ok(
      `${receiver} native balance: ${formatEther(current)} → ${c.bold(formatEther(next))}`,
    );
    return;
  }

  const config = loadConfig();
  const tokenAddr = resolveToken(config, chainId, tokenInput);
  if (!tokenAddr) {
    fail(
      `Unknown token "${tokenInput}" on chain ${chainId}. Use an address, or add an alias: sim tokens`,
    );
  }
  const token = asAddress(tokenAddr, "token");
  const { symbol, decimals } = await tokenMeta(clients, token);
  const amount = parseAmount(amountInput, decimals, opts.raw);

  const before = await clients.pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [receiver],
  });

  if (opts.whale) {
    const whale = asAddress(opts.whale, "whale");
    // Give the whale gas money, then transfer with auto-impersonation.
    await rpcRaw(clients.rpcUrl, "anvil_setBalance", [
      whale,
      `0x${parseEther("10").toString(16)}`,
    ]);
    const hash = await clients.wallet.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: "transfer",
      args: [receiver, amount],
      account: whale,
      chain: null,
    });
    await clients.pub.waitForTransactionReceipt({ hash });
    info(`Transferred from whale ${whale} (tx ${hash})`);
  } else {
    const target = opts.set ? amount : before + amount;
    await setTokenBalance(clients, chainId, token, receiver, target);
  }

  const after = await clients.pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [receiver],
  });
  if (!opts.whale && !opts.set && after !== before + amount) {
    fail(
      `Balance verification failed: expected ${before + amount}, got ${after}. Token may use non-standard storage — try --whale <address>.`,
    );
  }
  ok(
    `${receiver} ${symbol}: ${formatAmount(before, decimals)} → ${c.bold(formatAmount(after, decimals))}`,
  );
}
