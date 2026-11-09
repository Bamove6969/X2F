import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MetadataService, type MetadataStatement } from '@simplewebauthn/server';
import { decodeAttestationObject } from '@simplewebauthn/server/helpers';
import type { AttestationPolicy } from '../app.js';

export type { AttestationPolicy } from '../app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Which allowlist: the owner's (YubiKey 5 on firmware 5.7 or newer) or staff's (wider). */
export type AllowlistKind = 'owner' | 'staff';

const HEADINGS: Record<AllowlistKind, string> = { owner: 'Owner allowlist', staff: 'Staff allowlist' };

/**
 * The AAGUIDs listed as ``- `<aaguid>` ...`` lines under the README's "## Owner allowlist" or
 * "## Staff allowlist" heading, lower-cased. Throws when the heading is missing, when a ``- ` ``
 * line there does not hold a UUID, or when the list is empty (an empty list would refuse every
 * key of that account kind at registration, silently).
 */
export function parseAllowlist(readme: string, kind: AllowlistKind): string[] {
  const heading = HEADINGS[kind];
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- heading comes from the constant HEADINGS map, not user input
  const start = readme.search(new RegExp(`^## ${heading}[ \\t]*$`, 'm'));
  if (start < 0) throw new Error(`attestation: README.md has no "## ${heading}" section`);
  const rest = readme.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => /^#{1,2} /.test(l));
  const section = end < 0 ? rest : rest.slice(0, end);
  const ids: string[] = [];
  for (const line of section) {
    const m = /^- `([^`]*)`/.exec(line);
    if (!m) continue;
    const id = m[1]!.toLowerCase();
    if (!UUID.test(id)) throw new Error(`attestation: README.md "## ${heading}" has a line that is not an AAGUID: ${line.slice(0, 80)}`);
    ids.push(id);
  }
  if (ids.length === 0) throw new Error(`attestation: README.md "## ${heading}" is empty`);
  return ids;
}

/** The `- nextUpdate: YYYY-MM-DD` line of the README (the BLOB's own `nextUpdate`), as 00:00 UTC that day. */
export function parseNextUpdate(readme: string): Date {
  const m = /^- nextUpdate: (\d{4}-\d{2}-\d{2})$/m.exec(readme);
  const d = m ? new Date(`${m[1]}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime())) throw new Error('attestation: README.md has no "- nextUpdate: YYYY-MM-DD" line');
  return d;
}

/**
 * True for the error strict `MetadataService` throws when an attestation names an AAGUID with no
 * statement in the snapshot: for staff and owner that is a policy refusal, not a broken response.
 */
export function isUnknownAuthenticator(e: unknown): boolean {
  return e instanceof Error && /No metadata statement found/.test(e.message);
}

/**
 * The repo's FIDO metadata snapshot (`apps/api/data/fido-mds`, P2-I5). `init` loads every `*.json`
 * statement into `MetadataService` in `strict` mode with no metadata server (no network fetch) and
 * reads the README's two AAGUID allowlists (owner and staff, owner's rules of 2026-10-20); it throws
 * when the folder is unreadable, a statement is malformed, or an allowlisted AAGUID has no
 * statement. Until `init` has succeeded nothing is allowed. `isAllowed(aaguid, fmt, kind)` =
 * `fmt !== 'none'` and the AAGUID is on `kind`'s allowlist. Once the clock reaches
 * the README's `nextUpdate`, `init` warns (stderr by default) that the snapshot needs a refresh.
 *
 * `MetadataService` is process-wide: the last policy initialised is the one registration checks
 * certificate chains against.
 */
export function fileAttestationPolicy(
  dir: string,
  o: { clock?: () => Date; warn?: (message: string) => void } = {},
): AttestationPolicy {
  const clock = o.clock ?? (() => new Date());
  const warn = o.warn ?? ((message: string) => void process.stderr.write(`${JSON.stringify({ level: 40, msg: message })}\n`));
  let allowed: Readonly<Record<AllowlistKind, ReadonlySet<string>>> | null = null;
  return {
    async init() {
      const readme = await readFile(join(dir, 'README.md'), 'utf8');
      const owner = parseAllowlist(readme, 'owner');
      const staff = parseAllowlist(readme, 'staff');
      const next = parseNextUpdate(readme);
      if (clock().getTime() >= next.getTime()) {
        // The date only: never a path, a certificate or anything from the environment.
        warn(`FIDO metadata snapshot is past its nextUpdate (${next.toISOString().slice(0, 10)}); refresh it`);
      }
      const statements: MetadataStatement[] = [];
      for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
        const s = JSON.parse(await readFile(join(dir, file), 'utf8')) as Partial<MetadataStatement>;
        if (typeof s.aaguid !== 'string' || !UUID.test(s.aaguid) || file !== `${s.aaguid}.json`) {
          throw new Error(`attestation: ${file} is not a statement named after its AAGUID`);
        }
        if (!Array.isArray(s.attestationRootCertificates) || s.attestationRootCertificates.length === 0) {
          throw new Error(`attestation: ${file} has no attestation root certificates`);
        }
        statements.push(s as MetadataStatement);
      }
      const have = new Set(statements.map((s) => s.aaguid));
      const missing = [...new Set([...owner, ...staff])].filter((id) => !have.has(id));
      if (missing.length > 0) throw new Error(`attestation: allowlisted AAGUID without a statement: ${missing.join(', ')}`);
      await MetadataService.initialize({ mdsServers: [], statements, verificationMode: 'strict' });
      allowed = { owner: new Set(owner), staff: new Set(staff) };
    },
    isAllowed(aaguid, fmt, kind) {
      return allowed !== null && fmt !== 'none' && allowed[kind].has(aaguid.toLowerCase());
    },
  };
}

/**
 * True when the attestation statement carries a certificate chain (`x5c`). Self attestation (a
 * `packed` statement signed by the credential key itself) proves nothing about the device: anyone
 * can put any AAGUID in it, and `MetadataService` checks chains only when there is one.
 */
export function hasCertificateChain(attestationObject: Uint8Array): boolean {
  try {
    const x5c = decodeAttestationObject(attestationObject as Parameters<typeof decodeAttestationObject>[0]).get('attStmt').get('x5c');
    return Array.isArray(x5c) && x5c.length > 0;
  } catch {
    return false;
  }
}
