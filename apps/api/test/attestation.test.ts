import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileAttestationPolicy, parseAllowlist } from '../src/auth/attestation.js';
import { createTestCa, writeTestMds } from './helpers/softAuthenticator.js';

const SNAPSHOT = fileURLToPath(new URL('../data/fido-mds/', import.meta.url));
const YUBIKEY_5_NFC = 'fa2b99dc-9e39-4257-8f92-4a30d23c4118';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the repo FIDO metadata snapshot', () => {
  it('loads with no network fetch and allows only listed AAGUIDs with a real attestation format', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
    const policy = fileAttestationPolicy(SNAPSHOT);
    expect(policy.isAllowed(YUBIKEY_5_NFC, 'packed')).toBe(false); // nothing before init
    await policy.init();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(policy.isAllowed(YUBIKEY_5_NFC, 'packed')).toBe(true);
    expect(policy.isAllowed(YUBIKEY_5_NFC.toUpperCase(), 'packed')).toBe(true);
    expect(policy.isAllowed(YUBIKEY_5_NFC, 'none')).toBe(false);
    expect(policy.isAllowed('00000000-0000-0000-0000-000000000000', 'packed')).toBe(false);
  });

  it('has a statement for every allowlisted AAGUID, each a YubiKey 5 with root certificates', async () => {
    const readme = await readFile(join(SNAPSHOT, 'README.md'), 'utf8');
    const ids = parseAllowlist(readme);
    expect(ids.length).toBeGreaterThan(10);
    expect(readme).toMatch(/SHA-256 of the downloaded BLOB: `[0-9a-f]{64}`/);
    expect(readme).toContain('https://mds3.fidoalliance.org/');
    const files = (await readdir(SNAPSHOT)).filter((f) => f.endsWith('.json'));
    expect(files.sort()).toEqual(ids.map((id) => `${id}.json`).sort());
    for (const f of files) {
      const s = JSON.parse(await readFile(join(SNAPSHOT, f), 'utf8'));
      expect(s.description).toMatch(/^YubiKey 5 /);
      expect(s.attestationRootCertificates.length).toBeGreaterThan(0);
    }
  });
});

describe('fileAttestationPolicy', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads the allowlist only under its heading', () => {
    const readme = '- `11111111-1111-4111-8111-111111111111` before\n\n## Allowlist\n\n- `22222222-2222-4222-8222-222222222222` yes\nnot a line `33333333-3333-4333-8333-333333333333`\n\n## Other\n\n- `44444444-4444-4444-8444-444444444444` after\n';
    expect(parseAllowlist(readme)).toEqual(['22222222-2222-4222-8222-222222222222']);
    expect(() => parseAllowlist('# nothing here')).toThrow(/Allowlist/);
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
