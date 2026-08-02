import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { c, fail, info } from '../log.ts';

/**
 * Wrapper around the monorepo's simulation-testnet bash scripts, so the
 * remixdao-specific flows stay single-sourced but callable from anywhere
 * without pnpm/nx.
 */
const FLOWS: Record<string, { script: string; hint: string }> = {
  rewards: { script: 'generate_rewards.sh', hint: '-s <strategy> -c <chainId> [-l loops] [-r rpcUrl]' },
  dca: { script: 'execute_dca_plan.sh', hint: '-s <strategy|address> [-c chainId] [-p planIndex] [-t nextBlockTs] [-r rpcUrl]' },
  'fix-reinvest': { script: 'fix_reinvest_slippage.sh', hint: 'see script --help' },
  'aerodrome-prep': { script: 'aerodrome_earn_preparation.sh', hint: '-s <strategy> -c <chainId>' },
  'fund-erc20': { script: 'fund_erc20.sh', hint: '(legacy — prefer `sim fund`)' },
};

export function eweCommand(flow: string | undefined, args: string[]): void {
  const config = loadConfig();
  const repo = config.eweRepo ?? process.env.EWE_REPO;
  if (!repo) fail('Set the monorepo path first: sim init (or eweRepo: in ~/.simfork/config.yml)');

  if (!flow || !FLOWS[flow]) {
    info('Available EWE flows (proxied to apps/simulation-testnet/scripts):');
    for (const [name, meta] of Object.entries(FLOWS)) {
      console.log(`  ${c.bold(name.padEnd(16))} ${meta.script.padEnd(32)} ${c.dim(meta.hint)}`);
    }
    if (flow) fail(`Unknown flow: ${flow}`);
    return;
  }

  const appDir = join(repo, 'apps/simulation-testnet');
  const script = join(appDir, 'scripts', FLOWS[flow]!.script);
  if (!existsSync(script)) fail(`Script not found: ${script} — check eweRepo in config`);

  info(`Running ${FLOWS[flow]!.script} ${args.join(' ')}`);
  const result = spawnSync('bash', [script, ...args], { cwd: appDir, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
