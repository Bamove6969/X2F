/**
 * SASL SCRAM-SHA-256 and SCRAM-SHA-1 (RFC 5802, RFC 7677) for the Jabber sender (review L1): the
 * password never crosses the wire, and the server must prove it knows it (the `v=` signature in
 * `<success>`) before anything is sent. No channel binding (gs2 header `n,,`): the -PLUS variants
 * are not built (GAP, see xmpp.ts).
 *
 * The password is normalised with NFKC, which matches SASLprep (RFC 4013) for every password
 * without the characters SASLprep maps or prohibits (control characters, unassigned code points).
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

export type ScramHash = 'sha256' | 'sha1';
export const SCRAM_MECHANISMS: ReadonlyArray<readonly [string, ScramHash]> = [['SCRAM-SHA-256', 'sha256'], ['SCRAM-SHA-1', 'sha1']];

/** Iteration counts the client accepts: below RFC 7677's minimum is refused, and so is a count that would stall the worker. */
const MIN_ITERATIONS = 4096;
const MAX_ITERATIONS = 1_000_000;
const GS2 = 'n,,';

const saslName = (s: string) => s.replace(/=/g, '=3D').replace(/,/g, '=2C');

function attrs(msg: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of msg.split(',')) {
    const eq = part.indexOf('=');
    if (eq !== 1) throw new Error('scram');
    out.set(part[0]!, part.slice(2));
  }
  return out;
}

export interface ScramClient {
  /** The initial response (`<auth>` content), base64. */
  first(): string;
  /** The answer to the server's challenge (`<response>` content), base64. Throws on a bad challenge. */
  final(challengeB64: string): string;
  /** True only if `<success>` carries the server's correct signature. */
  verify(successB64: string): boolean;
}

export function scramClient(hash: ScramHash, user: string, password: string, nonce = randomBytes(18).toString('base64')): ScramClient {
  const bare = `n=${saslName(user)},r=${nonce}`;
  let serverSignature: Buffer | null = null;
  const hmac = (key: Buffer, s: string) => createHmac(hash, key).update(s, 'utf8').digest();
  return {
    first: () => Buffer.from(GS2 + bare, 'utf8').toString('base64'),
    final(challengeB64) {
      const serverFirst = Buffer.from(challengeB64, 'base64').toString('utf8');
      const a = attrs(serverFirst);
      const r = a.get('r');
      const s = a.get('s');
      const i = Number(a.get('i'));
      if (a.has('m') || !r || !r.startsWith(nonce) || r.length === nonce.length || !s) throw new Error('scram');
      if (!Number.isInteger(i) || i < MIN_ITERATIONS || i > MAX_ITERATIONS) throw new Error('scram');
      const salt = Buffer.from(s, 'base64');
      if (salt.length === 0) throw new Error('scram');
      const salted = pbkdf2Sync(password.normalize('NFKC'), salt, i, hash === 'sha256' ? 32 : 20, hash);
      const clientKey = hmac(salted, 'Client Key');
      const storedKey = createHash(hash).update(clientKey).digest();
      const withoutProof = `c=${Buffer.from(GS2, 'utf8').toString('base64')},r=${r}`;
      const authMessage = `${bare},${serverFirst},${withoutProof}`;
      const clientSignature = hmac(storedKey, authMessage);
      const proof = Buffer.from(clientKey.map((b, k) => b ^ clientSignature[k]!));
      serverSignature = hmac(hmac(salted, 'Server Key'), authMessage);
      return Buffer.from(`${withoutProof},p=${proof.toString('base64')}`, 'utf8').toString('base64');
    },
    verify(successB64) {
      if (serverSignature === null) return false;
      let v: string | undefined;
      try {
        v = attrs(Buffer.from(successB64, 'base64').toString('utf8')).get('v');
      } catch {
        return false;
      }
      if (v === undefined) return false;
      const given = Buffer.from(v, 'base64');
      return given.length === serverSignature.length && timingSafeEqual(given, serverSignature);
    },
  };
}
