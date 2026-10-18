import * as openpgp from 'openpgp';

/** Keys are dated well before every test clock, so none is "not yet valid" for the server. */
export const KEY_DATE = new Date('2026-01-01T00:00:00Z');

export type Pair = { publicKey: string; privateKey: string; fingerprint: string };

export async function genKey(
  o: { v6?: boolean; userIDs?: openpgp.UserID[]; date?: Date; keyExpirationTime?: number; subkeys?: openpgp.SubkeyOptions[] } = {},
): Promise<Pair> {
  const k = await openpgp.generateKey({
    ...(o.v6 ? { type: 'curve25519' as const, config: { v6Keys: true } } : { type: 'ecc' as const, curve: 'ed25519Legacy' as const }),
    userIDs: o.userIDs ?? [{ name: 'Test User' }],
    date: o.date ?? KEY_DATE,
    ...(o.keyExpirationTime !== undefined ? { keyExpirationTime: o.keyExpirationTime } : {}),
    ...(o.subkeys ? { subkeys: o.subkeys } : {}),
    format: 'armored',
  });
  const fingerprint = (await openpgp.readKey({ armoredKey: k.publicKey })).getFingerprint();
  return { publicKey: k.publicKey, privateKey: k.privateKey, fingerprint };
}

/** The same key material with new self-signatures (a later expiry); the fingerprint stays the same. */
export async function resign(pair: Pair, date: Date, keyExpirationTime: number): Promise<Pair> {
  const privateKey = await openpgp.readPrivateKey({ armoredKey: pair.privateKey });
  const r = await openpgp.reformatKey({ privateKey, userIDs: [{ name: 'Test User' }], date, keyExpirationTime, format: 'armored' });
  return { publicKey: r.publicKey, privateKey: r.privateKey, fingerprint: pair.fingerprint };
}

/** Decrypts a challenge with `privateKey`; with `signer`, also requires a valid signature by it, checked at `date` (the server clock). */
export async function decrypt(armoredMessage: string, privateArmored: string, signer?: string, date = new Date()): Promise<string> {
  const message = await openpgp.readMessage({ armoredMessage });
  const decryptionKeys = await openpgp.readPrivateKey({ armoredKey: privateArmored });
  if (signer === undefined) return (await openpgp.decrypt({ message, decryptionKeys })).data as string;
  const verificationKeys = await openpgp.readKey({ armoredKey: signer });
  const r = await openpgp.decrypt({ message, decryptionKeys, verificationKeys, expectSigned: true, date });
  return r.data as string;
}

/** The login code in a decrypted challenge. */
export function codeOf(text: string): string {
  const m = /^X2F login code: (\S+)$/m.exec(text);
  if (!m) throw new Error('no code in challenge');
  return m[1]!;
}
