import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  encodeAbiParameters,
  erc20Abi,
  keccak256,
  numberToHex,
  type Address,
  type Hex,
} from "viem";
import type { Clients } from "./rpc.ts";
import { SLOT_CACHE_PATH, ensureDirs } from "./paths.ts";

export type SlotLayout = "solidity" | "vyper";

export interface SlotInfo {
  index: number;
  layout: SlotLayout;
}

/** Storage slot of `balances[account]` for a mapping declared at `index`. */
export function computeBalanceSlot(
  account: Address,
  index: number,
  layout: SlotLayout,
): Hex {
  const key = { type: "address", value: account } as const;
  const idx = { type: "uint256", value: BigInt(index) } as const;
  // Solidity: keccak256(abi.encode(key, slotIndex)) — Vyper reverses the order.
  const [first, second] = layout === "solidity" ? [key, idx] : [idx, key];
  return keccak256(
    encodeAbiParameters(
      [{ type: first.type }, { type: second.type }],
      [first.value, second.value],
    ),
  );
}

interface SlotCache {
  [key: string]: SlotInfo;
}

function readCache(): SlotCache {
  if (!existsSync(SLOT_CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SLOT_CACHE_PATH, "utf8")) as SlotCache;
  } catch {
    return {};
  }
}

function writeCache(cache: SlotCache): void {
  ensureDirs();
  writeFileSync(SLOT_CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function balanceOf(
  clients: Clients,
  token: Address,
  account: Address,
): Promise<bigint | undefined> {
  try {
    return await clients.pub.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    });
  } catch {
    return undefined;
  }
}

/**
 * Find the storage slot index of an ERC20 `balanceOf` mapping by probing:
 * write a sentinel value into candidate slots and check whether balanceOf
 * reflects it, restoring the original storage afterwards. Works through
 * proxies because storage always lives at the token (proxy) address.
 */
export async function detectBalanceSlot(
  clients: Clients,
  chainId: number,
  token: Address,
  maxSlots = 128,
): Promise<SlotInfo> {
  const cacheKey = `${chainId}:${token.toLowerCase()}`;
  const cache = readCache();
  const cached = cache[cacheKey];
  if (cached) return cached;

  // A fixed probe address nobody uses; deterministic keeps runs reproducible.
  const probe = "0x1926844426fa1b9550494a7b37a243cf5a153a70" as Address;
  const sentinel = numberToHex(0x5117deadbeefn, { size: 32 });

  for (let index = 0; index < maxSlots; index++) {
    for (const layout of ["solidity", "vyper"] as const) {
      const slot = computeBalanceSlot(probe, index, layout);
      const original = await clients.pub.getStorageAt({ address: token, slot });
      await clients.test.setStorageAt({
        address: token,
        index: slot,
        value: sentinel,
      });
      const balance = await balanceOf(clients, token, probe);
      await clients.test.setStorageAt({
        address: token,
        index: slot,
        value: original ?? numberToHex(0n, { size: 32 }),
      });
      if (balance === BigInt(sentinel)) {
        const found: SlotInfo = { index, layout };
        cache[cacheKey] = found;
        writeCache(cache);
        return found;
      }
    }
  }

  throw new Error(
    `Could not locate the balance slot of ${token} within ${maxSlots} slots. ` +
      `Token may use non-standard balance storage (rebasing/shares). Try funding via a whale: --whale <address>`,
  );
}

/** Overwrite `balances[account]` with `value` (base units). */
export async function setTokenBalance(
  clients: Clients,
  chainId: number,
  token: Address,
  account: Address,
  value: bigint,
): Promise<void> {
  const { index, layout } = await detectBalanceSlot(clients, chainId, token);
  const slot = computeBalanceSlot(account, index, layout);
  await clients.test.setStorageAt({
    address: token,
    index: slot,
    value: numberToHex(value, { size: 32 }),
  });
}
