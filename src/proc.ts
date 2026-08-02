import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR, RUN_DIR, ensureDirs } from './paths.ts';

export interface Instance {
  port: number;
  chainId: number;
  pid: number;
  rpcUrl: string;
  forkBlock?: number;
  upstreamHost?: string;
  startedAt: string;
  logFile: string;
  /** Named snapshots: name → evm_snapshot id. */
  snapshots?: Record<string, string>;
}

function instancePath(port: number): string {
  return join(RUN_DIR, `${port}.json`);
}

export function logFileFor(port: number): string {
  return join(LOGS_DIR, `anvil-${port}.log`);
}

export function saveInstance(instance: Instance): void {
  ensureDirs();
  writeFileSync(instancePath(instance.port), JSON.stringify(instance, null, 2));
}

export function removeInstance(port: number): void {
  rmSync(instancePath(port), { force: true });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function listInstances(): Instance[] {
  if (!existsSync(RUN_DIR)) return [];
  const instances: Instance[] = [];
  for (const file of readdirSync(RUN_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      instances.push(JSON.parse(readFileSync(join(RUN_DIR, file), 'utf8')) as Instance);
    } catch {
      // corrupt record — ignore
    }
  }
  return instances.sort((a, b) => a.port - b.port);
}

export function liveInstances(): Instance[] {
  return listInstances().filter(instance => isAlive(instance.pid));
}

/** PIDs currently listening on a TCP port. */
export function pidsOnPort(port: number): number[] {
  try {
    const out = execSync(`lsof -ti tcp:${port} -s tcp:listen`, { encoding: 'utf8' });
    return out
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter(pid => Number.isFinite(pid));
  } catch {
    return []; // lsof exits 1 when nothing matches
  }
}

export function killPort(port: number): number[] {
  const pids = pidsOnPort(port);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  return pids;
}
