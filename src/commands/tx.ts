import { decodeFunctionResult, encodeFunctionData, parseEther } from 'viem';
import { coerceArgs, parseSig, renderResult } from '../sig.ts';
import { c, fail, info, ok } from '../log.ts';
import { asAddress, rpcRaw } from '../rpc.ts';
import { connect, type TargetOpts } from '../target.ts';

export interface SendOpts extends TargetOpts {
  from?: string;
  value?: string;
}

/**
 * sim send <to> <sig> [args...] --from <addr>
 * Runs with anvil auto-impersonation — any --from works, no key needed.
 */
export async function sendCommand(toInput: string, sig: string, rawArgs: string[], opts: SendOpts): Promise<void> {
  if (!opts.from) fail('Missing --from <address> (any address works — the fork auto-impersonates)');
  const { clients } = await connect(opts);
  const to = asAddress(toInput, 'to');
  const from = asAddress(opts.from, 'from');

  const { abi } = parseSig(sig);
  const data = encodeFunctionData({ abi: [abi], functionName: abi.name, args: coerceArgs(abi.inputs, rawArgs) });

  // Make sure the impersonated sender can pay gas.
  const gasBalance = await clients.pub.getBalance({ address: from });
  if (gasBalance < parseEther('1')) {
    await rpcRaw(clients.rpcUrl, 'anvil_setBalance', [from, `0x${parseEther('10').toString(16)}`]);
    info(`Topped up ${from} with 10 ETH for gas`);
  }

  const hash = await clients.wallet.sendTransaction({
    account: from,
    to,
    data,
    value: opts.value ? parseEther(opts.value) : undefined,
    chain: null,
  });
  const receipt = await clients.pub.waitForTransactionReceipt({ hash });
  if (receipt.status === 'success') {
    ok(`tx ${hash} — gas used ${receipt.gasUsed}`);
  } else {
    fail(`tx ${hash} REVERTED (gas used ${receipt.gasUsed})`);
  }
}

/**
 * sim call <to> <sig> [args...]
 * Cast-style return types supported: "balanceOf(address)(uint256)"
 */
export async function callCommand(toInput: string, sig: string, rawArgs: string[], opts: TargetOpts): Promise<void> {
  const { clients } = await connect(opts);
  const to = asAddress(toInput, 'to');
  const { abi } = parseSig(sig);
  const data = encodeFunctionData({ abi: [abi], functionName: abi.name, args: coerceArgs(abi.inputs, rawArgs) });

  const { data: result } = await clients.pub.call({ to, data });
  if (!result || result === '0x') {
    info('(empty result)');
    return;
  }
  if (!abi.outputs.length) {
    console.log(result);
    return;
  }
  const decoded = decodeFunctionResult({ abi: [abi], functionName: abi.name, data: result });
  console.log(renderResult(decoded));
}

/** sim rpc <method> [params...] — raw JSON-RPC escape hatch. */
export async function rpcCommand(method: string, params: string[], opts: TargetOpts): Promise<void> {
  const { clients } = await connect(opts);
  const parsed = params.map(param => {
    try {
      return JSON.parse(param);
    } catch {
      return param; // plain string param
    }
  });
  const result = await rpcRaw(clients.rpcUrl, method, parsed);
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  if (result === null) info(c.dim('(null result — call likely succeeded with no return value)'));
}
