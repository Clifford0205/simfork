const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const wrap = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
};

export function log(msg: string): void {
  console.log(msg);
}

export function info(msg: string): void {
  console.log(`${c.blue('ℹ')} ${msg}`);
}

export function ok(msg: string): void {
  console.log(`${c.green('✔')} ${msg}`);
}

export function warn(msg: string): void {
  console.warn(`${c.yellow('⚠')} ${msg}`);
}

export function fail(msg: string): never {
  console.error(`${c.red('✖')} ${msg}`);
  process.exit(1);
}
