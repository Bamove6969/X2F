/**
 * OMEMO for the Jabber sender (owner ruling p11-31: OMEMO is mandatory; XEP-0384, the version
 * clients deploy today, namespace `eu.siacs.conversations.axolotl`, "OMEMO 0.3"). The sender never
 * sends plaintext: it fetches the recipient's device list and bundles (PEP, XEP-0163) and refuses to
 * send when no bundle checks out; with bundles, the message body goes through `OmemoEncrypt`.
 *
 * Built here (no Double Ratchet needed): the PEP requests, parsing and checking each bundle (key
 * types and lengths, the signed prekey's XEdDSA signature under the identity key), and X2F's own
 * OMEMO identity (device id and Curve25519 identity key pair), created once and stored sealed under
 * X2F_JABBER_KEYS (`jabber_omemo_identity`, migration 332).
 *
 * NOT BUILT (GAP): the encryption itself. `ratchetEncryptor` is the NEEDS_OMEMO_RATCHET tripwire:
 * every send stops there, after the bundles were fetched and before any message is written. What it
 * takes to replace it is listed at `ratchetEncryptor`.
 */
import { createPublicKey, generateKeyPairSync, randomInt, verify } from 'node:crypto';
import type pg from 'pg';
import { keyringBox } from '../auth/keystore.js';
import type { Keyring } from '../config.js';

export const OMEMO_NS = 'eu.siacs.conversations.axolotl';
export const DEVICELIST_NODE = `${OMEMO_NS}.devicelist`;
export const bundleNode = (deviceId: number) => `${OMEMO_NS}.bundles:${deviceId}`;
/** Devices whose bundle the sender fetches, at most (a list longer than this is cut). */
export const MAX_DEVICES = 16;

/** The tripwire's marker: grep for it to find where the Double Ratchet goes. */
export const NEEDS_OMEMO_RATCHET = 'NEEDS_OMEMO_RATCHET';

/** A recipient device's published bundle, checked. Keys are in libsignal's form (0x05 ‖ 32 bytes). */
export interface OmemoBundle {
  deviceId: number;
  identityKey: Buffer;
  signedPreKeyId: number;
  signedPreKey: Buffer;
  signedPreKeySignature: Buffer;
  preKeys: Array<{ id: number; key: Buffer }>;
}

/** Encrypts `plaintext` to `bundles` and returns one `<encrypted xmlns='eu.siacs.conversations.axolotl'>` element. */
export type OmemoEncrypt = (input: { to: string; plaintext: string; bundles: OmemoBundle[] }) => Promise<string>;

// ---------------------------------------------------------------------------------------------
// XEdDSA verification (Signal's XEdDSA, as libsignal verifies it): the Montgomery u of the identity
// key is mapped to the Edwards y = (u - 1) / (u + 1), the sign bit is taken from the signature's top
// bit (which is then cleared), and the result is checked as an Ed25519 signature.

const P = 2n ** 255n - 19n;
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

function modpow(b: bigint, e: bigint): bigint {
  let r = 1n;
  for (b %= P; e > 0n; e >>= 1n, b = (b * b) % P) if (e & 1n) r = (r * b) % P;
  return r;
}

/** True when `sig` (64 bytes) is a valid XEdDSA signature of `msg` under the Curve25519 public key `mont` (32 bytes). */
export function xeddsaVerify(mont: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  if (mont.length !== 32 || sig.length !== 64) return false;
  let u = 0n;
  for (let i = 31; i >= 0; i--) u = (u << 8n) | BigInt(i === 31 ? mont[i]! & 0x7f : mont[i]!);
  if (u >= P || u === P - 1n) return false;
  let y = ((u - 1n + P) * modpow(u + 1n, P - 2n)) % P;
  const a = Buffer.alloc(32);
  for (let i = 0; i < 32; i++, y >>= 8n) a[i] = Number(y & 0xffn);
  a[31] = (a[31]! & 0x7f) | (sig[63]! & 0x80);
  const s = Buffer.from(sig);
  s[63] = s[63]! & 0x7f;
  try {
    return verify(null, msg, createPublicKey({ key: Buffer.concat([ED25519_SPKI, a]), format: 'der', type: 'spki' }), s);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// PEP requests and answers. The sender passes the answer of one `<iq>`; anything unexpected is
// treated as no devices or no bundle (the send is then refused, never sent in plaintext).

const PUBSUB = 'http://jabber.org/protocol/pubsub';

export const itemsRequest = (to: string, id: string, node: string, escape: (s: string) => string) =>
  `<iq type='get' id='${escape(id)}' to='${escape(to)}'><pubsub xmlns='${PUBSUB}'><items node='${escape(node)}'/></pubsub></iq>`;

const isResult = (iq: string) => /^<iq\b[^>]*\btype=['"]result['"]/.test(iq);
const DEVICE_ID = /^[1-9][0-9]{0,9}$/;
const validId = (s: string) => DEVICE_ID.test(s) && Number(s) <= 0x7fffffff;

/** The device ids in a device-list answer (first `MAX_DEVICES`, no repeats); [] when there is none. */
export function parseDeviceList(iq: string): number[] {
  if (!isResult(iq)) return [];
  const list = /<list\b[^>]*\bxmlns=['"]eu\.siacs\.conversations\.axolotl['"][^>]*>([\s\S]*?)<\/list>/.exec(iq);
  if (!list) return [];
  const ids: number[] = [];
  for (const m of list[1]!.matchAll(/<device\b[^>]*\bid=['"]([^'"]*)['"][^>]*\/?>/g)) {
    if (validId(m[1]!) && !ids.includes(Number(m[1]))) ids.push(Number(m[1]));
    if (ids.length >= MAX_DEVICES) break;
  }
  return ids;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
function key33(text: string | undefined): Buffer | null {
  if (text === undefined) return null;
  const t = text.trim();
  if (!B64.test(t)) return null;
  const b = Buffer.from(t, 'base64');
  return b.length === 33 && b[0] === 0x05 ? b : null;
}

/**
 * A bundle answer (the `<iq>`, or the `<bundle>` element itself), checked; null unless it has an
 * identity key, a signed prekey whose signature verifies under it, and at least one prekey.
 */
export function parseBundle(deviceId: number, xml: string): OmemoBundle | null {
  if (xml.startsWith('<iq') && !isResult(xml)) return null;
  const bundle = /<bundle\b[^>]*\bxmlns=['"]eu\.siacs\.conversations\.axolotl['"][^>]*>([\s\S]*?)<\/bundle>/.exec(xml)?.[1];
  if (bundle === undefined) return null;
  const el = (name: string) => new RegExp(`<${name}\\b([^>]*)>([^<]*)</${name}>`).exec(bundle);
  const spk = el('signedPreKeyPublic');
  const spkId = spk ? /\bsignedPreKeyId=['"]([^'"]*)['"]/.exec(spk[1]!)?.[1] : undefined;
  const identityKey = key33(el('identityKey')?.[2]);
  const signedPreKey = key33(spk?.[2]);
  const sigText = el('signedPreKeySignature')?.[2]?.trim();
  if (!identityKey || !signedPreKey || spkId === undefined || !/^[0-9]{1,10}$/.test(spkId) || !sigText || !B64.test(sigText)) return null;
  const signature = Buffer.from(sigText, 'base64');
  if (!xeddsaVerify(identityKey.subarray(1), signedPreKey, signature)) return null;
  const preKeys: Array<{ id: number; key: Buffer }> = [];
  for (const m of bundle.matchAll(/<preKeyPublic\b[^>]*\bpreKeyId=['"]([0-9]{1,10})['"][^>]*>([^<]*)<\/preKeyPublic>/g)) {
    const k = key33(m[2]);
    if (k) preKeys.push({ id: Number(m[1]), key: k });
  }
  if (preKeys.length === 0) return null;
  return { deviceId, identityKey, signedPreKeyId: Number(spkId), signedPreKey, signedPreKeySignature: signature, preKeys };
}

/** What an encryptor may return: exactly one OMEMO `<encrypted>` element, and never a `<body>`. */
export function isEncryptedElement(xml: string): boolean {
  return /^<encrypted xmlns='eu\.siacs\.conversations\.axolotl'>[\s\S]*<\/encrypted>$/.test(xml)
    && !/<body[\s>/]/.test(xml) && (xml.match(/<encrypted[\s>]/g) ?? []).length === 1;
}

// ---------------------------------------------------------------------------------------------
// X2F's own OMEMO identity.

export interface OmemoIdentity {
  /** Our device id (1 to 2^31 - 1), published in our device list once publishing is built. */
  deviceId: number;
  /** Curve25519 identity key pair, raw 32 bytes each. */
  publicKey: Buffer;
  privateKey: Buffer;
}

export const IDENTITY_CONTEXT = 'x2f/jabber-omemo-identity';

/**
 * X2F's OMEMO identity: created on first use (a random device id and a fresh Curve25519 key pair;
 * two processes racing keep the first one written) and stored with the private key sealed under
 * X2F_JABBER_KEYS. Throws when the stored key does not open (a removed key: `npm run rewrap-jabber`
 * before removing one).
 */
export async function loadOmemoIdentity(db: pg.Pool, ring: Keyring, now: Date): Promise<OmemoIdentity> {
  const box = keyringBox(ring);
  const read = async () =>
    (await db.query<{ device_id: number; identity_public: Buffer; identity_sealed: Buffer }>(
      'select device_id, identity_public, identity_sealed from jabber_omemo_identity',
    )).rows[0];
  let row = await read();
  if (!row) {
    const { publicKey, privateKey } = generateKeyPairSync('x25519');
    const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
    const priv = Buffer.from(privateKey.export({ format: 'jwk' }).d!, 'base64url');
    await db.query(
      `insert into jabber_omemo_identity (device_id, identity_public, identity_sealed, created_at) values ($1, $2, $3, $4)
       on conflict do nothing`,
      [randomInt(1, 0x7fffffff), pub, box.seal(priv, `${IDENTITY_CONTEXT}/${pub.toString('hex')}`), now],
    );
    priv.fill(0);
    row = (await read())!;
  }
  const privateKey = Buffer.from(box.open(row.identity_sealed, `${IDENTITY_CONTEXT}/${row.identity_public.toString('hex')}`));
  return { deviceId: row.device_id, publicKey: row.identity_public, privateKey };
}

/**
 * NEEDS_OMEMO_RATCHET: the production encryptor. It loads (or creates) X2F's identity, so the key
 * exists and opens, and then refuses: nothing is encrypted and nothing is sent.
 *
 * To replace it with real OMEMO 0.3 (the remainder, estimated in the review follow-up):
 * - X3DH key agreement against a recipient bundle (identity key, signed prekey, one prekey), our
 *   identity key and an ephemeral key, giving the PreKeySignalMessage for a first message;
 * - the Double Ratchet (root, chain and message keys, HKDF-SHA-256, header counters, skipped keys)
 *   and its per-device session state, stored sealed and updated in the same transaction as a send;
 * - the libsignal protobuf framing of SignalMessage / PreKeySignalMessage with its MAC;
 * - AES-128-GCM of the body under a random key and IV, that key (plus the GCM tag) encrypted to each
 *   recipient device and to our own other devices, in `<encrypted><header sid=…><key rid=… prekey=…>`;
 * - publishing our own device list and bundle (XEdDSA signing of our signed prekey, 100 prekeys,
 *   replenished as they are used), and trust: blind trust on first use, or the owner's rule;
 * - interop tests against Conversations, Dino and Gajim. A vetted library (libsignal's own
 *   bindings) would replace most of the first three items and is the safer route.
 */
/** The tripwire on its own (the sender's default when no encryptor is passed). */
export const needsRatchet: OmemoEncrypt = async () => {
  throw new Error(`${NEEDS_OMEMO_RATCHET}: OMEMO encryption (X3DH and the Double Ratchet, XEP-0384) is not built; no message was sent`);
};

export function ratchetEncryptor(identity: () => Promise<OmemoIdentity>): OmemoEncrypt {
  return async () => {
    const id = await identity();
    id.privateKey.fill(0);
    return needsRatchet({ to: '', plaintext: '', bundles: [] });
  };
}
