import { describe, expect, it } from 'vitest';
import { EscrowError, MoneroMultisigEngine, type MoneroMultisigSession } from '../src/index.js';

// Stagenet sessions with no daemon: setup is offline, and stagenet resumes through the
// monero-ts worker, the path that ships (regtest resumes in-process).
const engine = new MoneroMultisigEngine({ network: 'stagenet' });
const opts = { daemonUri: '', password: 'worker-test' };

describe('save and resume through the worker (stagenet, offline)', () => {
  it('a resumed session keeps its multisig address and readiness', async () => {
    const parties: MoneroMultisigSession[] = await Promise.all([0, 1, 2].map(() => engine.create(opts)));
    try {
      const others = (hex: string[], i: number): string[] => hex.filter((_, j) => j !== i);
      const prepared = await Promise.all(parties.map((p) => p.prepare()));
      let hex = await Promise.all(parties.map((p, i) => p.make(others(prepared, i))));
      for (;;) {
        const r = await Promise.all(parties.map((p, i) => p.exchange(others(hex, i))));
        if (r.every((x) => x.ready)) break;
        hex = r.map((x) => x.hex);
      }
      const address = await parties[0]!.address();
      expect(address.startsWith('5')).toBe(true); // stagenet primary address
      const saved = await parties[0]!.save();
      await parties[0]!.close();
      const resumed = await engine.resume(saved, opts);
      parties[0] = resumed;
      expect(await resumed.address()).toBe(address);
      expect((await resumed.wallet.getMultisigInfo()).getIsReady()).toBe(true);

      const wrong = await engine.resume(saved, { ...opts, password: 'wrong' }).then(() => null, (e: unknown) => e);
      expect(wrong).toBeInstanceOf(EscrowError);
      expect((wrong as EscrowError).code).toBe('bad-saved-session');

      const notWallet = await engine.resume({ v: 1, keys: 'AAAA', cache: 'AAAA' }, opts).then(() => null, (e: unknown) => e);
      expect((notWallet as EscrowError).code).toBe('bad-saved-session');
      const notBase64 = await engine.resume({ v: 1, keys: '%%%', cache: 'AAAA' }, opts).then(() => null, (e: unknown) => e);
      expect((notBase64 as EscrowError).code).toBe('bad-saved-session');
    } finally {
      for (const p of parties) await p.close().catch(() => undefined);
    }
  });
});
