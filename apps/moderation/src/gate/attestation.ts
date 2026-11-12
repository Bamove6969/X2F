import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MetadataService, type MetadataStatement } from '@simplewebauthn/server';
import type { GateAttestation } from './verify.js';

/**
 * The gate's attestation policy (Plan 4 Task 13), from the same FIDO metadata snapshot as the API
 * (`apps/api/data/fido-mds`, `MOD_FIDO_MDS_DIR`), read here by this process itself: the `*.json`
 * statements go into `MetadataService` in strict mode (so a registration's certificate chain is
 * checked against its statement's roots), and the README's "## Owner allowlist" / "## Staff
 * allowlist" sections are the AAGUIDs accepted. Until `init` succeeds nothing is allowed. It is the
 * API's `fileAttestationPolicy` again, not shared: this process may not load `@x2f/api`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEADINGS = { owner: 'Owner allowlist', staff: 'Staff allowlist' } as const;

/**
 * The AAGUIDs listed as ``- `<aaguid>` ...`` lines under "## Owner allowlist" or "## Staff
 * allowlist", lower-cased: the API's `parseAllowlist` line for line (review I2 pins the two together
 * on shared fixtures, CRLF included). Throws on a missing heading, a non-AAGUID line or an empty list.
 */
export function parseGateAllowlist(text: string, kind: keyof typeof HEADINGS): string[] {
  const readme = text.replace(/\r\n?/g, '\n');
  const heading = HEADINGS[kind];
  const lines = readme.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${heading}`) && /^[ \t]*$/.test(l.slice(`## ${heading}`.length)));
  if (start < 0) throw new Error(`gate: README.md has no "## ${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,2} /.test(l));
  const ids: string[] = [];
  for (const line of end < 0 ? rest : rest.slice(0, end)) {
    const m = /^- `([^`]*)`/.exec(line);
    if (!m) continue;
    const id = m[1]!.toLowerCase();
    if (!UUID.test(id)) throw new Error(`gate: README.md "## ${heading}" has a line that is not an AAGUID`);
    ids.push(id);
  }
  if (ids.length === 0) throw new Error(`gate: README.md "## ${heading}" is empty`);
  return ids;
}

export function fileGateAttestation(dir: string): GateAttestation & { init(): Promise<void> } {
  let allowed: Record<'owner' | 'staff', ReadonlySet<string>> | null = null;
  return {
    async init() {
      const readme = await readFile(join(dir, 'README.md'), 'utf8');
      const owner = parseGateAllowlist(readme, 'owner');
      const staff = parseGateAllowlist(readme, 'staff');
      const statements: MetadataStatement[] = [];
      for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
        const s = JSON.parse(await readFile(join(dir, file), 'utf8')) as Partial<MetadataStatement>;
        if (typeof s.aaguid !== 'string' || !UUID.test(s.aaguid) || file !== `${s.aaguid}.json`) throw new Error(`gate: ${file} is not a statement named after its AAGUID`);
        if (!Array.isArray(s.attestationRootCertificates) || s.attestationRootCertificates.length === 0) throw new Error(`gate: ${file} has no attestation root certificates`);
        statements.push(s as MetadataStatement);
      }
      const have = new Set(statements.map((s) => s.aaguid));
      if ([...owner, ...staff].some((id) => !have.has(id))) throw new Error('gate: an allowlisted AAGUID has no statement');
      await MetadataService.initialize({ mdsServers: [], statements, verificationMode: 'strict' });
      allowed = { owner: new Set(owner), staff: new Set(staff) };
    },
    isAllowed(aaguid, kind) {
      return allowed !== null && allowed[kind].has(aaguid.toLowerCase());
    },
  };
}
