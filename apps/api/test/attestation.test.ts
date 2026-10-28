import { X509Certificate } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileAttestationPolicy, parseAllowlist } from '../src/auth/attestation.js';
import { createTestCa, writeTestMds } from './helpers/softAuthenticator.js';

const SNAPSHOT = fileURLToPath(new URL('../data/fido-mds/', import.meta.url));
/** `authenticatorGetInfo.firmwareVersion` of 5.7.0 (major << 16 | minor << 8 | patch). */
const FW_5_7 = (5 << 16) | (7 << 8);
const YUBIKEY_5_58 = '0a357157-9b18-4c8a-920e-d156e972b2f8'; // YubiKey 5 Series (Consumer Profile), 5.8.0
const YUBIKEY_5_NFC_571 = 'a25342c0-3cdc-4414-8e46-f4807fca511c'; // YubiKey 5 Series with NFC, 5.7.1
const YUBIKEY_5_NFC_542 = '2fc0579f-8113-47ea-b116-bb5a8db9202a'; // YubiKey 5 Series with NFC, 5.4.2
const YUBIKEY_5_NFC_51 = 'fa2b99dc-9e39-4257-8f92-4a30d23c4118'; // YubiKey 5 Series with NFC, 5.1 (no firmware stated)
const SECURITY_KEY_NFC_574 = 'b7d3f68e-88a6-471e-9ecf-2df26d041ede'; // Security Key NFC by Yubico, 5.7.4
const TITAN_V2 = '42b4fb4a-2866-43b2-9bf7-6c6669c2e5d3'; // Google Titan Security Key v2

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the repo FIDO metadata snapshot', () => {
  it('loads with no network fetch and allows only listed AAGUIDs with a real attestation format', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
    const policy = fileAttestationPolicy(SNAPSHOT, { warn: () => {} });
    expect(policy.isAllowed(YUBIKEY_5_58, 'packed', 'owner')).toBe(false); // nothing before init
    await policy.init();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(policy.isAllowed(YUBIKEY_5_58, 'packed', 'owner')).toBe(true);
    expect(policy.isAllowed(YUBIKEY_5_58.toUpperCase(), 'packed', 'owner')).toBe(true);
    expect(policy.isAllowed(YUBIKEY_5_58, 'none', 'owner')).toBe(false);
    expect(policy.isAllowed(YUBIKEY_5_58, 'packed', 'staff')).toBe(true);
    expect(policy.isAllowed('00000000-0000-0000-0000-000000000000', 'packed', 'staff')).toBe(false);
  });

  it('applies the owner rules of 2026-10-20: owner YubiKey 5 on 5.7+, staff also older YubiKey 5, Security Key, Titan', async () => {
    const policy = fileAttestationPolicy(SNAPSHOT, { warn: () => {} });
    await policy.init();
    for (const [aaguid, owner] of [
      [YUBIKEY_5_58, true],
      [YUBIKEY_5_NFC_571, true],
      [YUBIKEY_5_NFC_51, false],
      [YUBIKEY_5_NFC_542, false],
      [SECURITY_KEY_NFC_574, false],
      [TITAN_V2, false],
    ] as const) {
      expect(policy.isAllowed(aaguid, 'packed', 'owner'), aaguid).toBe(owner);
      expect(policy.isAllowed(aaguid, 'packed', 'staff'), aaguid).toBe(true);
    }
    // Not on either list: a YubiKey Bio and a preview (not certified) YubiKey 5.
    for (const aaguid of ['7409272d-1ff9-4e10-9fc9-ac0019c124fd', '34f5766d-1536-4a24-9033-0e294e510fb0']) {
      expect(policy.isAllowed(aaguid, 'packed', 'staff')).toBe(false);
      expect(policy.isAllowed(aaguid, 'packed', 'owner')).toBe(false);
    }
  });

  it('has a statement for every allowlisted AAGUID, and each list matches its rule', async () => {
    const readme = await readFile(join(SNAPSHOT, 'README.md'), 'utf8');
    const owner = parseAllowlist(readme, 'owner');
    const staff = parseAllowlist(readme, 'staff');
    expect(owner.length).toBeGreaterThan(10);
    expect(staff.length).toBeGreaterThan(owner.length);
    expect(readme).toMatch(/SHA-256 of the downloaded BLOB: `[0-9a-f]{64}`/);
    expect(readme).toContain('https://mds3.fidoalliance.org/');
    const files = (await readdir(SNAPSHOT)).filter((f) => f.endsWith('.json'));
    expect(files.sort()).toEqual([...new Set([...owner, ...staff])].map((id) => `${id}.json`).sort());
    const statements = new Map<string, { description: string; firmware: number | undefined; roots: string[] }>();
    for (const f of files) {
      const s = JSON.parse(await readFile(join(SNAPSHOT, f), 'utf8'));
      expect(s.attestationRootCertificates.length).toBeGreaterThan(0);
      const roots = (s.attestationRootCertificates as string[]).map((b64) => new X509Certificate(Buffer.from(b64, 'base64')).subject);
      statements.set(s.aaguid, { description: s.description, firmware: s.authenticatorGetInfo?.firmwareVersion, roots });
    }
    for (const id of owner) {
      const s = statements.get(id)!;
      expect(s.description, id).toMatch(/^YubiKey 5 /);
      expect(s.firmware, id).toBeGreaterThanOrEqual(FW_5_7);
    }
    // Every YubiKey 5 on 5.7+ that staff may use, the owner may use too.
    const owners = new Set(owner);
    for (const id of staff) {
      const s = statements.get(id)!;
      expect(s.description, id).toMatch(/^(YubiKey 5 |Security Key |Enterprise Security Key |Google Titan Security Key)/);
      // The README rule: Yubico roots for YubiKey 5 and the Security Key series, Google's for Titan.
      for (const subject of s.roots) {
        if (/^Google Titan /.test(s.description)) expect(subject, id).toMatch(/^O=Google$/m);
        else expect(subject, id).toMatch(/Yubico/);
      }
      if (/^YubiKey 5 /.test(s.description) && (s.firmware ?? 0) >= FW_5_7) expect(owners.has(id), id).toBe(true);
    }
  });
});

describe('fileAttestationPolicy', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads each allowlist only under its own heading', () => {
    const readme = '- `11111111-1111-4111-8111-111111111111` before\n\n## Owner allowlist\n\n- `22222222-2222-4222-8222-222222222222` yes\nnot a line `33333333-3333-4333-8333-333333333333`\n\n## Staff allowlist\n\n- `55555555-5555-4555-8555-555555555555` staff\n\n## Other\n\n- `44444444-4444-4444-8444-444444444444` after\n';
    expect(parseAllowlist(readme, 'owner')).toEqual(['22222222-2222-4222-8222-222222222222']);
    expect(parseAllowlist(readme, 'staff')).toEqual(['55555555-5555-4555-8555-555555555555']);
    expect(() => parseAllowlist('# nothing here', 'owner')).toThrow(/Owner allowlist/);
    expect(() => parseAllowlist('## Owner allowlist\n', 'staff')).toThrow(/Staff allowlist/);
  });

  it('lower-cases an upper-case AAGUID line, and refuses a bad line or an empty list loudly', () => {
    const up = '## Staff allowlist\n\n- `ABCDEF01-2345-4678-89AB-CDEF01234567` upper\n';
    expect(parseAllowlist(up, 'staff')).toEqual(['abcdef01-2345-4678-89ab-cdef01234567']);
    expect(() => parseAllowlist('## Staff allowlist\n\n- `not-a-uuid` oops\n', 'staff')).toThrow(/not an AAGUID/);
    expect(() => parseAllowlist('## Owner allowlist\n\nnothing listed\n\n## Staff allowlist\n', 'owner')).toThrow(/Owner allowlist" is empty/);
  });

  it('refuses to start with an empty owner or staff list', async () => {
    dir = await mkdtemp(join(tmpdir(), 'x2f-mds-'));
    const ca = createTestCa();
    const a = '11111111-2222-4333-8444-555555555555';
    await writeTestMds(dir, ca, { statements: [a], allow: [a], ownerAllow: [] });
    await expect(fileAttestationPolicy(dir).init()).rejects.toThrow(/Owner allowlist" is empty/);
    await writeTestMds(dir, ca, { statements: [a], allow: [], ownerAllow: [a] });
    await expect(fileAttestationPolicy(dir).init()).rejects.toThrow(/Staff allowlist" is empty/);
  });

  it('keeps the two lists apart, and refuses an owner-only AAGUID without a statement', async () => {
    dir = await mkdtemp(join(tmpdir(), 'x2f-mds-'));
    const ca = createTestCa();
    const a = '11111111-2222-4333-8444-555555555555';
    const b = '66666666-7777-4888-8999-aaaaaaaaaaaa';
    await writeTestMds(dir, ca, { statements: [a, b], allow: [a, b], ownerAllow: [a] });
    const policy = fileAttestationPolicy(dir);
    await policy.init();
    expect(policy.isAllowed(a, 'packed', 'owner')).toBe(true);
    expect(policy.isAllowed(b, 'packed', 'owner')).toBe(false);
    expect(policy.isAllowed(b, 'packed', 'staff')).toBe(true);
    await rm(dir, { recursive: true, force: true });
    await writeTestMds(dir, ca, { statements: [a], allow: [a], ownerAllow: [a, b] });
    await expect(fileAttestationPolicy(dir).init()).rejects.toThrow(b);
  });

  it('M7: warns once at startup when the snapshot is past its nextUpdate, naming only the date', async () => {
    dir = await mkdtemp(join(tmpdir(), 'x2f-mds-'));
    const a = '11111111-2222-4333-8444-555555555555';
    await writeTestMds(dir, createTestCa(), { statements: [a], allow: [a], nextUpdate: '2026-11-01' });
    const warnings: string[] = [];
    const warn = (line: string) => void warnings.push(line);
    await fileAttestationPolicy(dir, { clock: () => new Date('2026-10-31T23:59:59Z'), warn }).init();
    expect(warnings).toEqual([]);
    await fileAttestationPolicy(dir, { clock: () => new Date('2026-11-01T00:00:00Z'), warn }).init();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('2026-11-01');
    expect(warnings[0]).not.toContain(dir);
    expect(warnings[0]).not.toMatch(/BEGIN|[A-Za-z0-9+/]{40}/);
  });

  it('refuses a README without a nextUpdate line, and the repo snapshot has one', async () => {
    dir = await mkdtemp(join(tmpdir(), 'x2f-mds-'));
    const a = '11111111-2222-4333-8444-555555555555';
    await writeTestMds(dir, createTestCa(), { statements: [a], allow: [a], nextUpdate: null });
    await expect(fileAttestationPolicy(dir).init()).rejects.toThrow(/nextUpdate/);
    const readme = await readFile(join(SNAPSHOT, 'README.md'), 'utf8');
    expect(readme).toMatch(/^- nextUpdate: 2026-11-01$/m);
    expect(readme).toMatch(/Refresh/);
  });

  it('refuses to start when an allowlisted AAGUID has no statement, or a file is misnamed', async () => {
    dir = await mkdtemp(join(tmpdir(), 'x2f-mds-'));
    const ca = createTestCa();
    const a = '11111111-2222-4333-8444-555555555555';
    const b = '66666666-7777-4888-8999-aaaaaaaaaaaa';
    await writeTestMds(dir, ca, { statements: [a], allow: [a, b] });
    await expect(fileAttestationPolicy(dir).init()).rejects.toThrow(b);
    await writeTestMds(dir, ca, { statements: [a], allow: [a] });
    await writeFile(join(dir, 'misnamed.json'), await readFile(join(dir, `${a}.json`)));
    await expect(fileAttestationPolicy(dir).init()).rejects.toThrow(/misnamed\.json/);
  });
});
