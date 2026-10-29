/**
 * A software WebAuthn authenticator for tests: ES256 keys from node:crypto, `none` or `packed`
 * attestation (an x5c leaf issued by a test CA, or self attestation with no chain), and every flag the server checks under the test's
 * control.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { cborEncode, type CborValue } from './cbor.js';
import { certificate } from './der.js';

const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string): Buffer => createHash('sha256').update(b).digest();

function p256(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

/** A self-signed test root that issues packed-attestation leaf certificates. */
export interface TestCa {
  /** DER of the root certificate. */
  cert: Buffer;
  /** A leaf for `aaguid` certifying `publicKey`, valid now (the library checks against the real clock). */
  issue(aaguid: Uint8Array, publicKey: KeyObject): Buffer;
}

const YEAR = 365 * 24 * 3600_000;

export function createTestCa(): TestCa {
  const { privateKey, publicKey } = p256();
  const root = { C: 'XX', O: 'X2F Test', CN: 'X2F Test Attestation Root' };
  const now = Date.now();
  const cert = certificate({
    serial: 1, issuer: root, subject: root, publicKey, signingKey: privateKey, ca: true,
    notBefore: new Date(now - YEAR), notAfter: new Date(now + 10 * YEAR),
  });
  let serial = 1;
  return {
    cert,
    issue: (aaguid, leafKey) =>
      certificate({
        serial: ++serial,
        issuer: root,
        subject: { C: 'XX', O: 'X2F Test', OU: 'Authenticator Attestation', CN: 'X2F Test Key' },
        publicKey: leafKey, signingKey: privateKey, ca: false, aaguid,
        notBefore: new Date(now - YEAR), notAfter: new Date(now + 5 * YEAR),
      }),
  };
}

export function aaguidBytes(uuid: string): Uint8Array {
  return new Uint8Array(Buffer.from(uuid.replace(/-/g, ''), 'hex'));
}

/**
 * Writes a FIDO metadata folder like `apps/api/data/fido-mds`: one statement per AAGUID in
 * `statements`, rooted at the test CA, and a README whose staff allowlist holds `allow` and whose
 * owner allowlist holds `ownerAllow` (default: `allow`).
 */
export async function writeTestMds(
  dir: string,
  ca: TestCa,
  a: { statements: string[]; allow: string[]; ownerAllow?: string[]; nextUpdate?: string | null },
): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const aaguid of a.statements) {
    const statement = {
      aaguid,
      description: `Test key ${aaguid}`,
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
      attestationRootCertificates: [ca.cert.toString('base64')],
    };
    await writeFile(join(dir, `${aaguid}.json`), JSON.stringify(statement));
  }
  const list = (ids: string[]) => ids.map((g) => `- \`${g}\` Test key`).join('\n');
  const next = a.nextUpdate === undefined ? '2099-01-01' : a.nextUpdate;
  const source = next === null ? '' : `- nextUpdate: ${next}\n\n`;
  await writeFile(join(dir, 'README.md'), `# Test metadata\n\n${source}- \`00000000-0000-4000-8000-000000000000\` above the heading: ignored\n\n## Owner allowlist\n\n${list(a.ownerAllow ?? a.allow)}\n\n## Staff allowlist\n\n${list(a.allow)}\n`);
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export interface SoftAuthenticator {
  register(options: PublicKeyCredentialCreationOptionsJSON, origin: string, o?: { rpId?: string }): RegistrationResponseJSON;
  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    origin: string,
    o?: { rpId?: string; type?: string; userHandle?: string },
  ): AuthenticationResponseJSON;
  /** The signature counter the next assertion reports. */
  setCounter(n: number): void;
  /** Flags can be changed between ceremonies. */
  flags: { backedUp: boolean; userVerified: boolean; userPresent: boolean };
  credentialId: string;
  /** The credential's COSE public key (for inserting a credential row directly). */
  cosePublicKey: Buffer;
}

export function createSoftAuthenticator(o: {
  backedUp: boolean;
  userVerified: boolean;
  userPresent?: boolean;
  attestation?: 'none' | { aaguid: string; ca: TestCa } | { aaguid: string; self: true };
}): SoftAuthenticator {
  const { privateKey, publicKey } = p256();
  // 64 bytes, the length of a YubiKey's non-discoverable credential ID (as the server's decoys).
  const credId = randomBytes(64);
  const jwk = publicKey.export({ format: 'jwk' });
  const cosePublicKey = cborEncode(
    new Map<number, CborValue>([
      [1, 2], // kty EC2
      [3, -7], // alg ES256
      [-1, 1], // crv P-256
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ]),
  );
  const flags = { backedUp: o.backedUp, userVerified: o.userVerified, userPresent: o.userPresent ?? true };
  let counter = 0;
  let userHandle: string | undefined;

  const flagByte = (extra: number) =>
    (flags.userPresent ? FLAG_UP : 0) | (flags.userVerified ? FLAG_UV : 0) |
    (flags.backedUp ? FLAG_BE | FLAG_BS : 0) | extra;
  const counterBytes = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };

  return {
    flags,
    credentialId: b64url(credId),
    cosePublicKey,
    setCounter(n) {
      counter = n;
    },
    register(options, origin, ro = {}) {
      userHandle = options.user.id;
      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }),
      );
      const att = o.attestation ?? 'none';
      const aaguid = att === 'none' ? new Uint8Array(16) : aaguidBytes(att.aaguid);
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(credId.length);
      const authData = Buffer.concat([
        sha256(ro.rpId ?? options.rp.id ?? ''),
        Buffer.from([flagByte(FLAG_AT)]),
        counterBytes(counter),
        aaguid, idLen, credId, cosePublicKey,
      ]);
      let fmt = 'none';
      let attStmt = new Map<string, CborValue>();
      if (att !== 'none' && 'self' in att) {
        // Self attestation: signed by the credential key itself, no certificate chain.
        const sig = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), { key: privateKey, dsaEncoding: 'der' });
        fmt = 'packed';
        attStmt = new Map<string, CborValue>([['alg', -7], ['sig', sig]]);
      } else if (att !== 'none') {
        const leaf = p256();
        const sig = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), { key: leaf.privateKey, dsaEncoding: 'der' });
        fmt = 'packed';
        attStmt = new Map<string, CborValue>([['alg', -7], ['sig', sig], ['x5c', [att.ca.issue(aaguid, leaf.publicKey)]]]);
      }
      const attestationObject = cborEncode(new Map<string, CborValue>([['fmt', fmt], ['attStmt', attStmt], ['authData', authData]]));
      return {
        id: b64url(credId),
        rawId: b64url(credId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientDataJSON),
          attestationObject: b64url(attestationObject),
          transports: ['usb'],
        },
        clientExtensionResults: {},
      };
    },
    authenticate(options, origin, ao = {}) {
      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: ao.type ?? 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }),
      );
      const authData = Buffer.concat([
        sha256(ao.rpId ?? options.rpId ?? ''),
        Buffer.from([flagByte(0)]),
        counterBytes(counter),
      ]);
      counter += 1;
      const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), { key: privateKey, dsaEncoding: 'der' });
      const handle = ao.userHandle ?? userHandle;
      return {
        id: b64url(credId),
        rawId: b64url(credId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientDataJSON),
          authenticatorData: b64url(authData),
          signature: b64url(signature),
          ...(handle !== undefined ? { userHandle: handle } : {}),
        },
        clientExtensionResults: {},
      };
    },
  };
}
