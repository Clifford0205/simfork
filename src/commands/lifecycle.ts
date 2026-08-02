import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { c, fail, info, log, ok, warn } from '../log.ts';
import { isAlive, listInstances, liveInstances, logFileFor, removeInstance, type Instance } from '../proc.ts';
import { isRpcUp, rpcRaw } from '../rpc.ts';
import { chainName } from '../tokens.ts';

function pickInstance(portArg: string | undefined, verb: string): Instance {
  const instances = listInstances();
  if (portArg) {
    const found = instances.find(instance => instance.port === Number(portArg));
    if (!found) fail(`No recorded fork on port ${portArg}. See: sim status`);
    return found;
  }
  const live = instances.filter(instance => isAlive(instance.pid));
  if (live.length === 1) return live[0]!;
  if (live.length === 0 && instances.length === 1) return instances[0]!;
  if (instances.length === 0) fail(`Nothing to ${verb} — no forks recorded. See: sim start`);
  fail(`Multiple forks found (ports ${instances.map(i => i.port).join(', ')}). Specify one: sim ${verb} <port>`);
}

export function stopCommand(portArg: string | undefined, opts: { all?: boolean }): void {
  const targets = opts.all ? listInstances() : [pickInstance(portArg, 'stop')];
  if (!targets.length) {
    info('No forks recorded.');
    return;
  }
  for (const instance of targets) {
    if (isAlive(instance.pid)) {
      try {
        process.kill(instance.pid, 'SIGTERM');
        ok(`Stopped fork on port ${instance.port} (pid ${instance.pid})`);
      } catch (err) {
        warn(`Could not kill pid ${instance.pid}: ${String(err)}`);
      }
    } else {
      info(`Fork on port ${instance.port} was already dead — cleaning up record.`);
    }
    removeInstance(instance.port);
  }
}

export async function statusCommand(): Promise<void> {
  const instances = listInstances();
  if (!instances.length) {
    info('No forks recorded. Start one with: sim start <chain>');
    return;
  }
  for (const instance of instances) {
    const alive = isAlive(instance.pid) && (await isRpcUp(instance.rpcUrl));
    let blockInfo = '';
    if (alive) {
      try {
        const block = Number((await rpcRaw(instance.rpcUrl, 'eth_blockNumber')) as string);
        blockInfo = `block ${block}`;
      } catch {
        blockInfo = 'block ?';
      }
    }
    const status = alive ? c.green('● running') : c.red('● dead');
    const uptime = alive ? ` up since ${instance.startedAt}` : '';
    log(
      `${status}  :${instance.port}  ${chainName(instance.chainId)} (${instance.chainId})  ${blockInfo}` +
        `${instance.forkBlock ? `  forked@${instance.forkBlock}` : ''}` +
        `${instance.upstreamHost ? `  via ${instance.upstreamHost}` : ''}  pid ${instance.pid}${uptime}`
    );
    if (!alive) removeInstance(instance.port);
  }
}

export function logsCommand(portArg: string | undefined, opts: { follow?: boolean; lines?: string }): void {
  const port = portArg ? Number(portArg) : (liveInstances()[0]?.port ?? 8545);
  const file = logFileFor(port);
  if (!existsSync(file)) fail(`No log file for port ${port} (${file})`);
  if (opts.follow) {
    spawnSync('tail', ['-f', '-n', opts.lines ?? '50', file], { stdio: 'inherit' });
  } else {
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    const n = Number(opts.lines ?? 50);
    log(lines.slice(-n).join('\n'));
  }
}
