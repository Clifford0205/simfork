import { erc20Abi, formatEther } from 'viem';
import { loadConfig, resolveToken, tokenAliases } from '../config.ts';
import { formatAmount } from '../amount.ts';
import { c, fail, log } from '../log.ts';
import { asAddress } from '../rpc.ts';
import { connect, tokenMeta, type TargetOpts } from '../target.ts';

/**
 * sim balance <address> [tokens...]
 * No tokens → native + every known alias for the chain (non-zero only).
 */
export async function balanceCommand(addressInput: string, tokens: string[], opts: TargetOpts): Promise<void> {
  const { clients, chainId } = await connect(opts);
  const address = asAddress(addressInput);
  const config = loadConfig();

  const native = await clients.pub.getBalance({ address });
  log(`${c.bold('native')}  ${formatEther(native)}`);

  const targets: string[] = tokens.length ? tokens : Object.keys(tokenAliases(config, chainId));
  for (const input of targets) {
    const resolved = resolveToken(config, chainId, input);
    if (!resolved) {
      if (tokens.length) fail(`Unknown token "${input}" on chain ${chainId}`);
      continue;
    }
    try {
      const token = asAddress(resolved, 'token');
      const balance = await clients.pub.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      });
      if (!tokens.length && balance === 0n) continue; // sweep mode: hide empty balances
      const { symbol, decimals } = await tokenMeta(clients, token);
      log(`${c.bold(symbol.padEnd(7))} ${formatAmount(balance, decimals)}  ${c.dim(token)}`);
    } catch {
      if (tokens.length) fail(`balanceOf failed for ${input} (${resolved})`);
    }
  }
}
