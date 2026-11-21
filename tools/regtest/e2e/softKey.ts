/**
 * Plan 4 Task 21: software security keys for the staff of the regtest stack (staffStack.ts). Each
 * key is plain data (JSON), so the stack can hand the owner's keys to the Playwright workers in
 * X2F_E2E_STACK: an ES256 key pair, its credential id and its signature counter. A key registers
 * with `packed` attestation from a test CA whose root the stack's FIDO metadata folder names (the
 * staff and owner allowlists hold KEY_AAGUID), so the staff API and the moderation process's gate
 * accept it as an attested hardware key. The same private key can be loaded into a browser's
 * virtual authenticator (staffKit.ts), so the staff app's own taps sign with it there.
 *
 * TEST ONLY: never used outside the e2e stack.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { cborEncode, type CborValue } from '../../../apps/api/test/helpers/cbor.js';
import { certificate } from '../../../apps/api/test/helpers/der.js';

/** On the stack's staff and owner allowlists. */
export const KEY_AAGUID = '21212121-2121-4121-8121-212121212121';

/** A test attestation CA (DER certificate and PKCS#8 key, base64). */
export interface CaData {
  cert: string;
  key: string;
}

/** A software security key. `counter` is the signature counter its next assertion reports. */
export interface KeyData {
  credentialId: string;
  /** PKCS#8 DER of the private key, base64 (what a virtual authenticator takes). */
  pkcs8: string;
  counter: number;
  /** The user handle the key was registered with (base64url), for assertions. */
  userHandle?: string;
  /** A synced passkey (registerPasskey), not a hardware key. */
  passkey?: boolean;
}

const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string): Buffer => createHash('sha256').update(b).digest();
const YEAR = 365 * 24 * 3600_000;
const ROOT_NAME = { C: 'XX', O: 'X2F e2e', CN: 'X2F e2e Attestation Root (not real)' };

function p256(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

export function newCa(): CaData {
  const { privateKey, publicKey } = p256();
  const now = Date.now();
  const cert = certificate({ serial: 1, issuer: ROOT_NAME, subject: ROOT_NAME, publicKey, signingKey: privateKey, ca: true, notBefore: new Date(now - YEAR), notAfter: new Date(now + 10 * YEAR) });
  return { cert: cert.toString('base64'), key: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') };
}

/** A self-signed TLS server certificate for `localhost` (PEM), for the staff origin's TLS front. */
export function localhostTls(): { cert: string; key: string } {
  const { privateKey, publicKey } = p256();
  const now = Date.now();
  const name = { C: 'XX', O: 'X2F e2e', CN: 'localhost' };
  const der = certificate({ serial: 7, issuer: name, subject: name, publicKey, signingKey: privateKey, ca: false, notBefore: new Date(now - 24 * 3600_000), notAfter: new Date(now + 30 * 24 * 3600_000), dnsNames: ['localhost'] });
  const pem = (label: string, b: Buffer) => `-----BEGIN ${label}-----\n${b.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END ${label}-----\n`;
  return { cert: pem('CERTIFICATE', der), key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}

export function newKey(): KeyData {
  const { privateKey } = p256();
  // 64 bytes, as a YubiKey's non-discoverable credential id.
  return { credentialId: b64url(randomBytes(64)), pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), counter: 0 };
}

const privateOf = (k: KeyData): KeyObject => createPrivateKey({ key: Buffer.from(k.pkcs8, 'base64'), format: 'der', type: 'pkcs8' });

function cosePublicKey(k: KeyData): Buffer {
  const jwk = createPublicKey(privateOf(k)).export({ format: 'jwk' });
  return cborEncode(new Map<number, CborValue>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
}

const counterBytes = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

/** Flags: user present and user verified (a key with a PIN, as staff keys are). */
const UP_UV = 0x01 | 0x04;
/** Flags: backup eligible and backed up (a synced passkey). */
const BE_BS = 0x08 | 0x10;

/**
 * A synced passkey's registration of `k` (backed up, fmt `none`, no AAGUID), as a phone or password
 * manager makes it: a moderator's second method beside the PGP key (D-070).
 */
export function registerPasskey(k: KeyData, options: PublicKeyCredentialCreationOptionsJSON, origin: string, rpId = 'localhost'): RegistrationResponseJSON {
  k.userHandle = options.user.id;
  k.passkey = true;
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
  const credId = Buffer.from(k.credentialId, 'base64url');
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(credId.length);
  const authData = Buffer.concat([sha256(options.rp.id ?? rpId), Buffer.from([UP_UV | BE_BS | 0x40]), counterBytes(k.counter), Buffer.alloc(16), idLen, credId, cosePublicKey(k)]);
  const attestationObject = cborEncode(new Map<string, CborValue>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  return {
    id: k.credentialId,
    rawId: k.credentialId,
    type: 'public-key',
    response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ['internal', 'hybrid'] },
    clientExtensionResults: {},
  };
}

/** A packed-attestation registration of `k` for `options`, as a hardware key on `origin` makes it. */
export function register(k: KeyData, ca: CaData, options: PublicKeyCredentialCreationOptionsJSON, origin: string, rpId = 'localhost'): RegistrationResponseJSON {
  k.userHandle = options.user.id;
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
  const credId = Buffer.from(k.credentialId, 'base64url');
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(credId.length);
  const aaguid = Buffer.from(KEY_AAGUID.replace(/-/g, ''), 'hex');
  const authData = Buffer.concat([sha256(options.rp.id ?? rpId), Buffer.from([UP_UV | 0x40]), counterBytes(k.counter), aaguid, idLen, credId, cosePublicKey(k)]);
  const leaf = p256();
  const caKey = createPrivateKey({ key: Buffer.from(ca.key, 'base64'), format: 'der', type: 'pkcs8' });
  const now = Date.now();
  const leafCert = certificate({
    serial: 2 + randomBytes(2).readUInt16BE(),
    issuer: ROOT_NAME,
    subject: { C: 'XX', O: 'X2F e2e', OU: 'Authenticator Attestation', CN: 'X2F e2e Key' },
    publicKey: leaf.publicKey, signingKey: caKey, ca: false, aaguid,
    notBefore: new Date(now - YEAR), notAfter: new Date(now + 5 * YEAR),
  });
  const sig = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), { key: leaf.privateKey, dsaEncoding: 'der' });
  const attStmt = new Map<string, CborValue>([['alg', -7], ['sig', sig], ['x5c', [leafCert]]]);
  const attestationObject = cborEncode(new Map<string, CborValue>([['fmt', 'packed'], ['attStmt', attStmt], ['authData', authData]]));
  return {
    id: k.credentialId,
    rawId: k.credentialId,
    type: 'public-key',
    response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ['usb'] },
    clientExtensionResults: {},
  };
}

/** An assertion by `k` for `options` on `origin`; the key's counter moves on by one. */
export function authenticate(k: KeyData, options: PublicKeyCredentialRequestOptionsJSON, origin: string, rpId = 'localhost'): AuthenticationResponseJSON {
  k.counter += 1;
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
  const authData = Buffer.concat([sha256(options.rpId ?? rpId), Buffer.from([UP_UV | (k.passkey ? BE_BS : 0)]), counterBytes(k.counter)]);
  const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), { key: privateOf(k), dsaEncoding: 'der' });
  return {
    id: k.credentialId,
    rawId: k.credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: b64url(clientDataJSON),
      authenticatorData: b64url(authData),
      signature: b64url(signature),
      ...(k.userHandle !== undefined ? { userHandle: k.userHandle } : {}),
    },
    clientExtensionResults: {},
  };
}

/**
 * A FIDO metadata folder like apps/api/data/fido-mds holding only the test key: its statement,
 * rooted at the test CA, and a README whose owner and staff allowlists hold KEY_AAGUID.
 */
export async function writeMds(dir: string, ca: CaData): Promise<void> {
  await mkdir(dir, { recursive: true });
  const statement = {
    aaguid: KEY_AAGUID,
    description: 'X2F e2e test key (not real)',
    authenticatorVersion: 1,
    protocolFamily: 'fido2',
    schema: 3,
    upv: [{ major: 1, minor: 0 }],
    authenticationAlgorithms: ['secp256r1_ecdsa_sha256_raw'],
    publicKeyAlgAndEncodings: ['cose'],
    attestationTypes: ['basic_full'],
    userVerificationDetails: [[{ userVerificationMethod: 'presence_internal' }]],
    keyProtection: ['hardware', 'secure_element'],
    matcherProtection: ['on_chip'],
    attachmentHint: ['external', 'wired'],
    tcDisplay: [],
    attestationRootCertificates: [ca.cert],
  };
  await writeFile(join(dir, `${KEY_AAGUID}.json`), JSON.stringify(statement));
  const line = `- \`${KEY_AAGUID}\` X2F e2e test key`;
  await writeFile(join(dir, 'README.md'), `# X2F e2e metadata (test only)\n\n- nextUpdate: 2099-01-01\n\n## Owner allowlist\n\n${line}\n\n## Staff allowlist\n\n${line}\n`);
}
