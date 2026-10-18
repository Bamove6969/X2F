/**
 * Test keys, generated once per test run (memoized per worker). RSA keys are
 * slow to make, so they are created only when a test asks for them.
 */
import * as openpgp from 'openpgp';

export type Pair = { publicKey: string; privateKey: string };

const userIDs = [{ name: 'Test User' }];

function once<T>(make: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= make());
}

async function gen(o: Omit<openpgp.KeyOptions, 'userIDs' | 'format'>): Promise<Pair> {
  const k = await openpgp.generateKey({ ...o, userIDs, format: 'armored' });
  return { publicKey: k.publicKey, privateKey: k.privateKey };
}

export const ed25519Legacy = once(() => gen({ type: 'ecc', curve: 'ed25519Legacy' }));
export const ed25519LegacyB = once(() => gen({ type: 'ecc', curve: 'ed25519Legacy' }));
export const v6Curve25519 = once(() => gen({ type: 'curve25519', config: { v6Keys: true } }));
export const curve448 = once(() => gen({ type: 'curve448' }));
export const rsa4096 = once(() => gen({ type: 'rsa', rsaBits: 4096 }));
export const rsa2048 = once(() => gen({ type: 'rsa', rsaBits: 2048 }));
export const nistP256 = once(() => gen({ type: 'ecc', curve: 'nistP256' }));
/** Made two days before `now`, valid for one day. */
export const expired = (now: Date) =>
  gen({ type: 'ecc', curve: 'ed25519Legacy', date: new Date(now.getTime() - 2 * 86_400_000), keyExpirationTime: 86_400 });
/** Primary key plus nine encryption subkeys. */
export const nineSubkeys = once(() =>
  gen({ type: 'ecc', curve: 'ed25519Legacy', subkeys: Array.from({ length: 9 }, () => ({})) }),
);
/** A key passed through `openpgp.revokeKey`. */
export const revoked = once(async () => {
  const base = await ed25519Legacy();
  const key = await openpgp.readPrivateKey({ armoredKey: base.privateKey });
  const r = await openpgp.revokeKey({ key, format: 'armored' });
  return { publicKey: r.publicKey, privateKey: r.privateKey };
});
/** The stand-in for the official X2F signing key. */
export const signing = once(() => gen({ type: 'ecc', curve: 'ed25519Legacy' }));
