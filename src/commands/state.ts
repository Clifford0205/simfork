import { parseDuration } from '../amount.ts';
import { c, fail, info, ok } from '../log.ts';
import { liveInstances, saveInstance } from '../proc.ts';
import { rpcRaw } from '../rpc.ts';
import { connect, resolveRpcUrl, type TargetOpts } from '../target.ts';

function instanceFor(rpcUrl: string) {
  return liveInstances().find(instance => instance.rpcUrl === rpcUrl);
}

/** sim snapshot [-m name] — take an evm snapshot, optionally named. */
export async function snapshotCommand(opts: TargetOpts & { name?: string }): Promise<void> {
  const { clients } = await connect(opts);
  const id = (await rpcRaw(clients.rpcUrl, 'evm_snapshot')) as string;
  if (opts.name) {
    const instance = instanceFor(clients.rpcUrl);
    if (instance) {
      instance.snapshots = { ...instance.snapshots, [opts.name]: id };
      saveInstance(instance);
    }
    ok(`Snapshot ${c.bold(opts.name)} = ${id}`);
  } else {
    ok(`Snapshot ${id}`);
  }
}

/** sim revert <id|name> — revert to a snapshot (id or previously saved name). */
export async function revertCommand(ref: string, opts: TargetOpts): Promise<void> {
  const { clients } = await connect(opts);
  let id = ref;
  const instance = instanceFor(clients.rpcUrl);
  if (!ref.startsWith('0x') && instance?.snapshots?.[ref]) {
    id = instance.snapshots[ref]!;
  }
  const reverted = (await rpcRaw(clients.rpcUrl, 'evm_revert', [id])) as boolean;
  if (!reverted) fail(`Snapshot ${ref} not found or already consumed (anvil snapshots are one-shot).`);
  // Consumed snapshots (and any taken after it) are invalid — drop stale names.
  if (instance?.snapshots) {
    instance.snapshots = Object.fromEntries(Object.entries(instance.snapshots).filter(([, sid]) => BigInt(sid) < BigInt(id)));
    saveInstance(instance);
  }
  ok(`Reverted to snapshot ${ref}`);
  info(c.dim('Note: anvil snapshots are consumed on revert — take a new one if you need to return here again.'));
}

/**
 * sim time <+1d|+2h|<unix ts>> — advance or pin block time, then mine a block
 * so the change is observable immediately.
 */
export async function timeCommand(input: string, opts: TargetOpts): Promise<void> {
  const { clients } = await connect(opts);
  if (input.startsWith('+')) {
    const seconds = parseDuration(input);
    await rpcRaw(clients.rpcUrl, 'evm_increaseTime', [seconds]);
    await rpcRaw(clients.rpcUrl, 'anvil_mine', ['0x1']);
    ok(`Advanced time by ${seconds}s and mined a block`);
  } else {
    const ts = Number(input);
    if (!Number.isFinite(ts)) fail(`Cannot parse timestamp: ${input} (use +<duration> or a unix timestamp)`);
    await rpcRaw(clients.rpcUrl, 'evm_setNextBlockTimestamp', [ts]);
    await rpcRaw(clients.rpcUrl, 'anvil_mine', ['0x1']);
    ok(`Next block mined at timestamp ${ts} (${new Date(ts * 1000).toISOString()})`);
  }
}

/** sim mine [n] [--interval seconds] */
export async function mineCommand(countArg: string | undefined, opts: TargetOpts & { interval?: string }): Promise<void> {
  const { clients } = await connect(opts);
  const count = Number(countArg ?? 1);
  const params: unknown[] = [`0x${count.toString(16)}`];
  if (opts.interval) params.push(`0x${Number(opts.interval).toString(16)}`);
  await rpcRaw(clients.rpcUrl, 'anvil_mine', params);
  const block = Number((await rpcRaw(clients.rpcUrl, 'eth_blockNumber')) as string);
  ok(`Mined ${count} block(s) — now at block ${block}`);
}

export { resolveRpcUrl };
