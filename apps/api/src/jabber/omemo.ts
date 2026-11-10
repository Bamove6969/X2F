/**
 * OMEMO for the Jabber sender (owner ruling p11-31: OMEMO is mandatory; XEP-0384 0.3.0, the version
 * the common clients accept, namespace `eu.siacs.conversations.axolotl`; docs/jabber/omemo-plan.md).
 * The sender never sends plaintext: it publishes X2F's own device list and bundle, fetches the
 * recipient's device list and bundles (PEP, XEP-0163), refuses to send when no bundle checks out,
 * and encrypts the fixed text to every device whose bundle does (blind trust before verification;
 * owner question 1 in the plan).
 *
 * Here: the PEP requests, parsing and checking each bundle (key types and lengths, the signed
 * prekey's XEdDSA signature under the identity key), X2F's own OMEMO identity (device id and an
 * Ed25519 seed, from which the Curve25519 identity key and OpenSSL's XEdDSA-compatible signer come;
 * `@x2f/omemo` `identityFromSeed`) and bundle (signed prekey, 100 prekeys), both created once and
 * stored sealed under X2F_JABBER_KEYS (`jabber_omemo_identity`, migrations 332 and 333), and the
 * production encryptor. The cryptography (X3DH, Double Ratchet, libsignal framing, the envelope) is
 * `@x2f/omemo`. Every notice is a fresh session and a PreKeySignalMessage per device: no session
 * state is kept (plan, section 2.8).
 */
import { randomInt } from 'node:crypto';
import type pg from 'pg';
import {
  PreKeysExhausted, bundleXml, deviceListXml, encryptMessage, generateBundleSecrets, identityFromSeed, newIdentitySeed, parseBundleSecrets, serializeBundleSecrets, xeddsaVerify,
  PreKeyLedger, type BundleSecrets, type SeedIdentity,
} from '@x2f/omemo';
import { keyringBox } from '../auth/keystore.js';
import type { Keyring } from '../config.js';
import { dbPreKeyStore, type PreKeyStore } from './prekeys.js';
import { NoticeDeferred } from './sender.js';

export { xeddsaVerify };

export const OMEMO_NS = 'eu.siacs.conversations.axolotl';
export const DEVICELIST_NODE = `${OMEMO_NS}.devicelist`;
export const bundleNode = (deviceId: number) => `${OMEMO_NS}.bundles:${deviceId}`;
/** Devices whose bundle the sender fetches, at most (a list longer than this is cut). */
export const MAX_DEVICES = 16;

/** A recipient device's published bundle, checked. Keys are in libsignal's form (0x05 ‖ 32 bytes). */
export interface OmemoBundle {
  deviceId: number;
  identityKey: Buffer;
  signedPreKeyId: number;
  signedPreKey: Buffer;
  signedPreKeySignature: Buffer;
  preKeys: Array<{ id: number; key: Buffer }>;
}

/**
 * Encrypts `plaintext` to `bundles` and returns one `<encrypted xmlns='eu.siacs.conversations.axolotl'>`
 * element. `preKeys` is the outbox pass's ledger (review M2), when the send belongs to one; when it
 * has no prekey left for one of the devices, rejects with `NoticeDeferred` (interop step 4b).
 */
export type OmemoEncrypt = (input: { to: string; plaintext: string; bundles: OmemoBundle[]; preKeys?: PreKeyLedger }) => Promise<string>;

/** What the sender publishes to its own PEP nodes before each message. */
export interface OmemoAnnouncement {
  deviceId: number;
  /** The `<list>` item for `DEVICELIST_NODE`. */
  deviceList: string;
  /** The `<bundle>` item for `bundleNode(deviceId)`. */
  bundle: string;
}
export type OmemoAnnounce = () => Promise<OmemoAnnouncement>;

export interface OmemoEncryptor {
  announce: OmemoAnnounce;
  encrypt: OmemoEncrypt;
}

/** The encryptor's only log line: a recipient device skipped for a key the agreement refuses (review L2), by its id. */
export type OmemoLog = (e: { jabber: 'omemo'; skippedDevice: number }) => void;

// ---------------------------------------------------------------------------------------------
// PEP requests and answers. The sender passes the answer of one `<iq>`; anything unexpected is
// treated as no devices or no bundle (the send is then refused, never sent in plaintext).

const PUBSUB = 'http://jabber.org/protocol/pubsub';

export const itemsRequest = (to: string, id: string, node: string, escape: (s: string) => string) =>
  `<iq type='get' id='${escape(id)}' to='${escape(to)}'><pubsub xmlns='${PUBSUB}'><items node='${escape(node)}'/></pubsub></iq>`;

/**
 * Publishes `item` (an element `@x2f/omemo` built) as item `current` of our own `node`, persistent
 * and with the open access model, so that users of other servers can read our keys (XEP-0060
 * publish-options; XEP-0384 recommends `open`).
 */
export const publishRequest = (id: string, node: string, item: string, escape: (s: string) => string) =>
  `<iq type='set' id='${escape(id)}'><pubsub xmlns='${PUBSUB}'><publish node='${escape(node)}'><item id='current'>${item}</item></publish>` +
  `<publish-options><x xmlns='jabber:x:data' type='submit'><field var='FORM_TYPE' type='hidden'><value>${PUBSUB}#publish-options</value></field>` +
  `<field var='pubsub#persist_items'><value>true</value></field><field var='pubsub#access_model'><value>open</value></field></x></publish-options></pubsub></iq>`;

const isResult = (iq: string) => /^<iq\b[^>]*\btype=['"]result['"]/.test(iq);
export const isResultIq = isResult;
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
// X2F's own OMEMO identity and bundle.

/**
 * X2F's identity: an Ed25519 seed's `SeedIdentity` (`@x2f/omemo`: the Montgomery `publicKey` the
 * bundle publishes, the X25519 `privateKey` X3DH uses, OpenSSL's `sign`) plus our device id.
 */
export interface OmemoIdentity extends SeedIdentity {
  /** Our device id (1 to 2^31 - 1), published in our device list. */
  deviceId: number;
}

export const IDENTITY_CONTEXT = 'x2f/jabber-omemo-identity';
export const BUNDLE_CONTEXT = 'x2f/jabber-omemo-bundle';
/**
 * The sealed identity's plaintext: this byte, then the 32-byte Ed25519 seed. Before the landing
 * (lead decision after review L1) the plaintext was the bare 32-byte X25519 scalar; no production
 * row was ever written in that form (the sender has never been lit: `X2F_XMPP_*` is unset, the
 * identity row is created on first use), so there is nothing to migrate and the rewrap is
 * unchanged (it reseals the plaintext as opaque bytes). A row in the old form is refused, not misread.
 */
const SEALED_SEED_V1 = 0x01;

/**
 * X2F's OMEMO identity: created on first use (a random device id and a fresh Ed25519 seed; two
 * processes racing keep the first one written) and stored with the seed sealed under
 * X2F_JABBER_KEYS, bound to the Montgomery public key. Throws when the stored seed does not open (a
 * removed key: `npm run rewrap-jabber` before removing one) or does not derive the stored public key.
 */
export async function loadOmemoIdentity(db: pg.Pool, ring: Keyring, now: Date): Promise<OmemoIdentity> {
  const box = keyringBox(ring);
  const read = async () =>
    (await db.query<{ device_id: number; identity_public: Buffer; identity_sealed: Buffer }>(
      'select device_id, identity_public, identity_sealed from jabber_omemo_identity',
    )).rows[0];
  let row = await read();
  if (!row) {
    const seed = newIdentitySeed();
    const fresh = identityFromSeed(seed);
    const plain = Buffer.concat([Buffer.from([SEALED_SEED_V1]), seed]);
    await db.query(
      `insert into jabber_omemo_identity (device_id, identity_public, identity_sealed, created_at) values ($1, $2, $3, $4)
       on conflict do nothing`,
      [randomInt(1, 0x7fffffff), fresh.publicKey, box.seal(plain, `${IDENTITY_CONTEXT}/${fresh.publicKey.toString('hex')}`), now],
    );
    plain.fill(0);
    seed.fill(0);
    fresh.privateKey.fill(0);
    row = (await read())!;
  }
  const opened = Buffer.from(box.open(row.identity_sealed, `${IDENTITY_CONTEXT}/${row.identity_public.toString('hex')}`));
  if (opened.length !== 33 || opened[0] !== SEALED_SEED_V1) {
    throw new Error('jabber: the OMEMO identity row is not an Ed25519 seed (the pre-landing form); no production row was ever in it, so drop the row and a new identity is created on first use');
  }
  const identity = identityFromSeed(opened.subarray(1));
  opened.fill(0);
  if (!identity.publicKey.equals(row.identity_public)) throw new Error('jabber: the OMEMO identity does not derive its stored public key');
  return { deviceId: row.device_id, ...identity };
}

/**
 * X2F's OMEMO bundle (signed under `identity`): created on first use (two processes racing keep the
 * first one written) and stored sealed under X2F_JABBER_KEYS in the identity's row. Throws when it
 * does not open or does not verify under the identity key.
 */
export async function loadOmemoBundle(db: pg.Pool, ring: Keyring, identity: OmemoIdentity): Promise<BundleSecrets> {
  const box = keyringBox(ring);
  const context = `${BUNDLE_CONTEXT}/${identity.publicKey.toString('hex')}`;
  const read = async () =>
    (await db.query<{ bundle_sealed: Buffer | null }>('select bundle_sealed from jabber_omemo_identity where identity_public = $1', [identity.publicKey])).rows[0];
  let row = await read();
  if (row === undefined) throw new Error('jabber: the OMEMO identity row is gone');
  if (row.bundle_sealed === null) {
    const fresh = serializeBundleSecrets(generateBundleSecrets(identity));
    await db.query('update jabber_omemo_identity set bundle_sealed = $2 where identity_public = $1 and bundle_sealed is null', [identity.publicKey, box.seal(fresh, context)]);
    fresh.fill(0);
    row = (await read())!;
    if (row.bundle_sealed === null) throw new Error('jabber: the OMEMO bundle was not stored');
  }
  return parseBundleSecrets(box.open(row.bundle_sealed, context), identity.privateKey);
}

/**
 * The encryptor for a loaded identity and bundle (tests build one in memory). With `store` (the
 * production encryptor's database record, prekeys.ts) every send, in a pass or not, picks only
 * prekeys X2F has not used on that device before; a send outside a pass gets a ledger of its own.
 */
export function omemoEncryptorFrom(identity: OmemoIdentity, bundle: BundleSecrets, log?: OmemoLog, store?: PreKeyStore): OmemoEncryptor {
  return {
    announce: async () => ({ deviceId: identity.deviceId, deviceList: deviceListXml([identity.deviceId]), bundle: bundleXml(identity.publicKey, bundle) }),
    encrypt: async ({ to, plaintext, bundles, preKeys }) => {
      const ledger = preKeys ?? (store ? new PreKeyLedger() : undefined);
      const run = () =>
        encryptMessage(identity, plaintext, bundles, {
          ...(ledger ? ledger.forRecipient(to) : {}),
          onSkip: (deviceId) => log?.({ jabber: 'omemo', skippedDevice: deviceId }),
        });
      try {
        return store && ledger ? await store.withRecord(to, bundles, ledger, run) : run();
      } catch (e) {
        if (e instanceof PreKeysExhausted) throw new NoticeDeferred();
        throw e;
      }
    },
  };
}

/**
 * The production encryptor: loads (or creates) X2F's identity and bundle for each use, so a
 * rotated key ring is picked up and the private keys are not kept in memory between sends.
 */
export function omemoEncryptor(db: pg.Pool, ring: Keyring, clock: () => Date, log?: OmemoLog): OmemoEncryptor {
  const store = dbPreKeyStore(db, ring, clock);
  const load = async () => {
    const identity = await loadOmemoIdentity(db, ring, clock());
    try {
      return { identity, bundle: await loadOmemoBundle(db, ring, identity) };
    } catch (e) {
      identity.privateKey.fill(0);
      throw e;
    }
  };
  const done = (identity: OmemoIdentity, bundle: BundleSecrets) => {
    identity.privateKey.fill(0);
    bundle.signedPreKey.privateKey.fill(0);
    for (const p of bundle.preKeys) p.key.privateKey.fill(0);
  };
  return {
    announce: async () => {
      const { identity, bundle } = await load();
      try {
        return await omemoEncryptorFrom(identity, bundle).announce();
      } finally {
        done(identity, bundle);
      }
    },
    encrypt: async (input) => {
      const { identity, bundle } = await load();
      try {
        return await omemoEncryptorFrom(identity, bundle, log, store).encrypt(input);
      } finally {
        done(identity, bundle);
      }
    },
  };
}
