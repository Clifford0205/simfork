import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type TestClient,
  type WalletClient,
} from 'viem';

export interface Clients {
  rpcUrl: string;
  pub: PublicClient;
  test: TestClient<'anvil'>;
  wallet: WalletClient;
}

export function makeClients(rpcUrl: string): Clients {
  const transport = http(rpcUrl, { timeout: 60_000 });
  return {
    rpcUrl,
    pub: createPublicClient({ transport }),
    test: createTestClient({ mode: 'anvil', transport }),
    wallet: createWalletClient({ transport }),
  };
}

let rpcId = 0;

/** Raw JSON-RPC call for methods viem does not wrap (anvil_setChainId, …). */
export async function rpcRaw(rpcUrl: string, method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} for ${method}`);
  const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
  if (body.error) throw new Error(`${method} failed: ${body.error.message} (code ${body.error.code})`);
  return body.result;
}

export async function isRpcUp(rpcUrl: string): Promise<boolean> {
  try {
    await rpcRaw(rpcUrl, 'eth_blockNumber');
    return true;
  } catch {
    return false;
  }
}

export async function chainIdOf(rpcUrl: string): Promise<number> {
  const hex = (await rpcRaw(rpcUrl, 'eth_chainId')) as string;
  return Number(hex);
}

export function asAddress(value: string, label = 'address'): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value as Address;
}
