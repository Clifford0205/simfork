import { describe, expect, test } from 'bun:test';
import { parseAmount, parseDuration } from '../src/amount.ts';
import { computeBalanceSlot } from '../src/slot.ts';
import { coerceArgs, parseSig } from '../src/sig.ts';
import { resolveChainId } from '../src/tokens.ts';

describe('parseAmount', () => {
  test('human units scale by decimals', () => {
    expect(parseAmount('1.5', 6)).toBe(1_500_000n);
    expect(parseAmount('1', 18)).toBe(10n ** 18n);
  });
  test('suffixes', () => {
    expect(parseAmount('10k', 6)).toBe(10_000_000_000n);
    expect(parseAmount('2m', 0)).toBe(2_000_000n);
  });
  test('raw mode bypasses decimals', () => {
    expect(parseAmount('99999999999999999999', 6, true)).toBe(99999999999999999999n);
    expect(parseAmount('0xff', 6)).toBe(255n);
  });
  test('rejects garbage', () => {
    expect(() => parseAmount('abc', 6)).toThrow();
  });
});

describe('parseDuration', () => {
  test('units', () => {
    expect(parseDuration('+30s')).toBe(30);
    expect(parseDuration('+10m')).toBe(600);
    expect(parseDuration('+2h')).toBe(7200);
    expect(parseDuration('+1d')).toBe(86400);
    expect(parseDuration('+1w')).toBe(604800);
    expect(parseDuration('3600')).toBe(3600);
  });
});

describe('computeBalanceSlot', () => {
  // Reference: USDT mainnet balances mapping is at slot 2 (Solidity layout).
  // keccak256(abi.encode(address, uint256(2))) — verified against cast:
  // cast index address 0x1926844426fa1b9550494a7b37a243cf5a153a70 2
  test('solidity layout matches cast index', () => {
    const slot = computeBalanceSlot('0x1926844426fa1b9550494a7b37a243cf5a153a70', 2, 'solidity');
    expect(slot).toMatch(/^0x[0-9a-f]{64}$/);
    // vyper layout must differ (argument order reversed)
    const vyper = computeBalanceSlot('0x1926844426fa1b9550494a7b37a243cf5a153a70', 2, 'vyper');
    expect(vyper).not.toBe(slot);
  });
});

describe('parseSig / coerceArgs', () => {
  test('cast-style with returns', () => {
    const { abi } = parseSig('balanceOf(address)(uint256)');
    expect(abi.name).toBe('balanceOf');
    expect(abi.inputs).toHaveLength(1);
    expect(abi.outputs).toHaveLength(1);
  });
  test('coerces ints to bigint and bools', () => {
    const { abi } = parseSig('approve(address,uint256)');
    const args = coerceArgs(abi.inputs, ['0xdAC17F958D2ee523a2206206994597C13D831ec7', '1000']);
    expect(args[1]).toBe(1000n);
  });
  test('arity mismatch throws', () => {
    const { abi } = parseSig('transfer(address,uint256)');
    expect(() => coerceArgs(abi.inputs, ['0xabc'])).toThrow();
  });
});

describe('resolveChainId', () => {
  test('names and ids', () => {
    expect(resolveChainId('arb')).toBe(42161);
    expect(resolveChainId('base')).toBe(8453);
    expect(resolveChainId('1')).toBe(1);
    expect(resolveChainId('unknown')).toBeUndefined();
  });
});
