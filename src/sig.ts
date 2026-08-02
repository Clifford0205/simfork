import { parseAbiItem, type AbiFunction, type AbiParameter } from 'viem';

export interface ParsedSig {
  abi: AbiFunction;
}

/**
 * Parse a cast-style signature: `transfer(address,uint256)` or
 * `balanceOf(address)(uint256)` (with return types).
 */
export function parseSig(sig: string): ParsedSig {
  const match = sig.trim().match(/^([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:\(([^)]*)\))?$/);
  if (!match) throw new Error(`Cannot parse function signature: ${sig}`);
  const [, name, inputs, outputs] = match;
  const returns = outputs?.trim() ? ` returns (${outputs})` : '';
  const abi = parseAbiItem(`function ${name}(${inputs})${returns}`) as AbiFunction;
  return { abi };
}

/** Coerce CLI string args into viem-compatible values based on ABI types. */
export function coerceArgs(params: readonly AbiParameter[], rawArgs: string[]): unknown[] {
  if (params.length !== rawArgs.length) {
    throw new Error(`Expected ${params.length} argument(s), got ${rawArgs.length}`);
  }
  return params.map((param, i) => coerceArg(param, rawArgs[i]!));
}

function coerceArg(param: AbiParameter, raw: string): unknown {
  const type = param.type;
  if (type.endsWith('[]')) {
    const inner = { ...param, type: type.slice(0, -2) };
    const items = raw.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
    return items.map(item => coerceArg(inner, item));
  }
  if (type.startsWith('uint') || type.startsWith('int')) return BigInt(raw);
  if (type === 'bool') return raw === 'true' || raw === '1';
  if (type === 'address' || type.startsWith('bytes') || type === 'string') return raw;
  if (type === 'tuple') throw new Error('Tuple arguments are not supported — use `sim rpc` with raw calldata');
  return raw;
}

/** Render decoded return values for terminal output. */
export function renderResult(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return `[${value.map(renderResult).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  }
  return String(value);
}
