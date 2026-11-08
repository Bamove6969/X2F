/**
 * DEMO ONLY. The hard guard every tools/demo process runs before doing anything.
 *
 * The demo stack (docs/demo.md) is a local prototype with fake money: a Monero regtest chain,
 * demo-generated secrets and seeded accounts. Nothing in tools/demo is imported by apps/* or
 * packages/*, and nothing here is part of any production build (tools/separation-check and the
 * guard test enforce both). Each demo process refuses to start unless:
 *  - X2F_DEMO is exactly "1", and
 *  - the Monero daemon it was given reports itself as a regtest (fakechain) node, never mainnet,
 *    stagenet or testnet.
 */

export class DemoRefused extends Error {
  constructor(reason: string) {
    super(`demo refused: ${reason}`);
    this.name = 'DemoRefused';
  }
}

/** True only when X2F_DEMO is exactly "1". */
export function demoFlagOn(env: Record<string, string | undefined>): boolean {
  return env.X2F_DEMO === '1';
}

export function assertDemoFlag(env: Record<string, string | undefined>): void {
  if (!demoFlagOn(env)) throw new DemoRefused('X2F_DEMO=1 is not set');
}

/** Only a node bound to this machine may be the demo node. */
export function assertLoopbackUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DemoRefused('the daemon URL is malformed');
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '[::1]') {
    throw new DemoRefused('the daemon must be on 127.0.0.1');
  }
}

/** What monerod's get_info says about its network. */
export interface NetInfo {
  nettype?: unknown;
  mainnet?: unknown;
  stagenet?: unknown;
  testnet?: unknown;
}

/** Regtest only: `--regtest` reports nettype "fakechain" and none of the real-network flags. */
export function isRegtestInfo(info: NetInfo): boolean {
  return info.nettype === 'fakechain' && info.mainnet !== true && info.stagenet !== true && info.testnet !== true;
}

export async function assertRegtestDaemon(rpcUri: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  assertLoopbackUrl(rpcUri);
  let info: NetInfo;
  try {
    const res = await fetchImpl(`${rpcUri}/json_rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '0', method: 'get_info' }),
    });
    info = ((await res.json()) as { result?: NetInfo }).result ?? {};
  } catch {
    throw new DemoRefused('the daemon did not answer get_info');
  }
  if (!isRegtestInfo(info)) throw new DemoRefused('the daemon is not a regtest node');
}

/** Both checks; every demo process calls this first. */
export async function assertDemo(env: Record<string, string | undefined>, rpcUri: string): Promise<void> {
  assertDemoFlag(env);
  await assertRegtestDaemon(rpcUri);
}
