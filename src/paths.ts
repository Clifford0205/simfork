import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const SIMFORK_HOME = process.env.SIMFORK_HOME ?? join(homedir(), '.simfork');
export const CONFIG_PATH = join(SIMFORK_HOME, 'config.yml');
export const RUN_DIR = join(SIMFORK_HOME, 'run');
export const LOGS_DIR = join(SIMFORK_HOME, 'logs');
export const CACHE_DIR = join(SIMFORK_HOME, 'cache');
export const SLOT_CACHE_PATH = join(CACHE_DIR, 'slots.json');

export function ensureDirs(): void {
  for (const dir of [SIMFORK_HOME, RUN_DIR, LOGS_DIR, CACHE_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}
