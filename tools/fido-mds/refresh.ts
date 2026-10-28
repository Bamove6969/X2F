// Refreshes the API's FIDO metadata snapshot (`apps/api/data/fido-mds`, Plan 2 Task 8, P2-I5) from
// a FIDO Alliance MDS3 BLOB that was downloaded by hand from https://mds3.fidoalliance.org/.
//
//   npx tsx tools/fido-mds/refresh.ts <blob.jwt> [snapshot dir, default apps/api/data/fido-mds]
//
// The BLOB is untrusted input until `verifyMDSBlob` (@simplewebauthn/server) has checked its
// certificate chain against the FIDO MDS root and its JWT signature; nothing is read from it before.
// Then, per the rules in the snapshot README ("Extraction"; owner's security-key rules of 2026-10-20):
//
// - an entry is skipped when it has no AAGUID or statement, when ANY of its status reports, past or
//   present, is NOT_FIDO_CERTIFIED, REVOKED, USER_VERIFICATION_BYPASS or *_COMPROMISE, or when its
//   statement has no attestation root certificates;
// - staff: Yubico roots (every root subject names Yubico) with a description starting `YubiKey 5 `,
//   or containing `Security Key` and not starting with `YubiKey`; or Google roots (every root has
//   O=Google) with a description starting `Google Titan Security Key`;
// - owner: the `YubiKey 5 ` entries whose authenticatorGetInfo.firmwareVersion is 5.7.0 or newer.
//
// It writes each kept statement (image fields removed, 2-space JSON, final newline) as
// `<aaguid>.json`, deletes `<uuid>.json` files no longer kept, and rewrites in the README the
// `- BLOB serial`, `- nextUpdate:` and `- SHA-256` lines and both allowlist sections. Update the
// README's "Fetched" line by hand, then review `git diff` (lists and root certificates).
import { createHash, X509Certificate } from 'node:crypto';
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyMDSBlob } from '@simplewebauthn/server/helpers';

const BAD = new Set(['NOT_FIDO_CERTIFIED', 'REVOKED', 'USER_VERIFICATION_BYPASS']);
const IMAGE_FIELDS = new Set(['icon', 'iconDark', 'providerLogoLight', 'providerLogoDark']);
const OWNER_MIN_FIRMWARE = (5 << 16) | (7 << 8); // 5.7.0
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

interface Entry {
  aaguid?: string;
  metadataStatement?: Record<string, unknown> & {
    description: string;
    attestationRootCertificates?: string[];
    authenticatorGetInfo?: { firmwareVersion?: unknown };
  };
  statusReports?: Array<{ status: string }>;
}

type Family = 'YubiKey 5' | 'Security Key' | 'Titan';

/** The family an entry belongs to, or null when it is on no list. */
function familyOf(description: string, rootSubjects: string[]): Family | null {
  if (rootSubjects.length === 0) return null;
  const yubico = rootSubjects.every((s) => s.includes('Yubico'));
  const google = rootSubjects.every((s) => /^O=Google$/m.test(s));
  if (yubico && description.startsWith('YubiKey 5 ')) return 'YubiKey 5';
  if (yubico && description.includes('Security Key') && !description.startsWith('YubiKey')) return 'Security Key';
  if (google && description.startsWith('Google Titan Security Key')) return 'Titan';
  return null;
}

/** Every root certificate's subject, one `KEY=value` per line (node:crypto's format). */
function rootSubjects(roots: string[]): string[] {
  return roots.map((b64) => new X509Certificate(Buffer.from(b64, 'base64')).subject);
}

const firmware = (v: number) => `${v >> 16}.${(v >> 8) & 255}.${v & 255}`;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function replaceSection(readme: string, heading: string, body: string): string {
  const start = readme.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`README has no "## ${heading}" section`);
  const from = start + `\n## ${heading}\n`.length;
  const next = readme.indexOf('\n## ', from);
  const end = next < 0 ? readme.length : next + 1;
  return `${readme.slice(0, from)}\n${body}\n${next < 0 ? '' : '\n'}${readme.slice(end)}`;
}

function replaceLine(readme: string, re: RegExp, line: string): string {
  if (!re.test(readme)) throw new Error(`README has no line matching ${re}`);
  return readme.replace(re, line);
}

async function main(blobPath: string, dir: string): Promise<void> {
  const blob = readFileSync(blobPath, 'utf8').trim();
  const sha256 = createHash('sha256').update(readFileSync(blobPath)).digest('hex');
  const { payload } = await verifyMDSBlob(blob); // throws on a bad chain or signature
  const owner: Array<[string, string, string]> = [];
  const staff: Array<[string, string, string]> = [];
  const kept = new Set<string>();
  for (const e of payload.entries as Entry[]) {
    const ms = e.metadataStatement;
    if (!ms || !e.aaguid) continue;
    const statuses = (e.statusReports ?? []).map((s) => s.status);
    if (statuses.some((s) => BAD.has(s) || s.endsWith('_COMPROMISE'))) continue;
    const roots = ms.attestationRootCertificates ?? [];
    const family = familyOf(ms.description, rootSubjects(roots));
    if (!family) continue;
    const fw = ms.authenticatorGetInfo?.firmwareVersion;
    const certs = statuses.filter((s) => s.startsWith('FIDO_CERTIFIED_')).join(', ');
    const fwText = typeof fw === 'number' ? `firmware ${firmware(fw)}` : 'firmware not stated';
    const row: [string, string, string] = [ms.description, e.aaguid, `- \`${e.aaguid}\` ${ms.description} (${certs}; ${fwText})`];
    staff.push(row);
    if (family === 'YubiKey 5' && typeof fw === 'number' && fw >= OWNER_MIN_FIRMWARE) owner.push(row);
    const statement = Object.fromEntries(Object.entries(ms).filter(([k]) => !IMAGE_FIELDS.has(k)));
    writeFileSync(join(dir, `${e.aaguid}.json`), `${JSON.stringify(statement, null, 2)}\n`);
    kept.add(`${e.aaguid}.json`);
  }
  for (const f of readdirSync(dir)) if (UUID_FILE.test(f) && !kept.has(f)) unlinkSync(join(dir, f));
  const lines = (rows: Array<[string, string, string]>) =>
    rows.sort((a, b) => byText(a[0], b[0]) || byText(a[1], b[1])).map((r) => r[2]).join('\n');
  let readme = readFileSync(join(dir, 'README.md'), 'utf8');
  readme = replaceLine(readme, /^- BLOB serial `no`: .*$/m, `- BLOB serial \`no\`: ${payload.no}`);
  readme = replaceLine(readme, /^- nextUpdate: .*$/m, `- nextUpdate: ${payload.nextUpdate}`);
  readme = replaceLine(readme, /^- SHA-256 of the downloaded BLOB: .*$/m, `- SHA-256 of the downloaded BLOB: \`${sha256}\``);
  readme = replaceSection(readme, 'Owner allowlist', lines(owner));
  readme = replaceSection(readme, 'Staff allowlist', lines(staff));
  writeFileSync(join(dir, 'README.md'), readme);
  process.stdout.write(`verified BLOB no ${payload.no}, nextUpdate ${payload.nextUpdate}, sha256 ${sha256}\n`);
  process.stdout.write(`owner ${owner.length}, staff ${staff.length}; update the README "Fetched" line and review git diff\n`);
}

const [blobPath, dir = 'apps/api/data/fido-mds'] = process.argv.slice(2);
if (!blobPath) {
  process.stderr.write('usage: tsx tools/fido-mds/refresh.ts <blob.jwt> [snapshot dir]\n');
  process.exit(2);
}
await main(blobPath, dir);
