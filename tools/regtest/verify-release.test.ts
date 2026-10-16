import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./verify-release.sh', import.meta.url));
const NAME = 'monero-fake.tar.bz2';

let dir: string;
let home: string;
let n = 0;

function gpg(args: string[], input?: string): string {
  const opts = { env: { ...process.env, GNUPGHOME: home }, encoding: 'utf8' as const, stdio: 'pipe' as const, ...(input === undefined ? {} : { input }) };
  const base = input === undefined ? ['--batch'] : ['--no-tty', '--command-fd', '0', '--status-fd', '2'];
  return execFileSync('gpg', [...base, '--yes', '--pinentry-mode', 'loopback', '--passphrase', '', ...args], opts);
}

interface Key { fpr: string; pub: string }

function makeKey(expiry: string, fakedTime?: string): Key {
  const uid = `Test ${n++} <t${n}@example.invalid>`;
  const faked = fakedTime ? ['--faked-system-time', fakedTime] : [];
  gpg([...faked, '--quick-gen-key', uid, 'ed25519', 'sign', expiry]);
  const colons = gpg(['--with-colons', '--list-keys', uid]);
  const fpr = colons.split('\n').find((l) => l.startsWith('fpr:'))?.split(':')[9] ?? '';
  return { fpr, pub: uid };
}

function exportKey(k: Key): string {
  const f = join(dir, `${k.fpr}.asc`);
  writeFileSync(f, gpg(['--armor', '--export', k.pub]));
  return f;
}

function sign(k: Key, fakedTime?: string): { hashes: string; tarball: string; sha: string } {
  const tarball = join(dir, NAME);
  writeFileSync(tarball, `fake tarball ${n++}`);
  const sha = execFileSync('sha256sum', [tarball], { encoding: 'utf8' }).split(' ')[0] ?? '';
  const plain = join(dir, `plain-${n}.txt`);
  writeFileSync(plain, `${sha}  ${NAME}\n`);
  const faked = fakedTime ? ['--faked-system-time', fakedTime] : [];
  const hashes = join(dir, `hashes-${n}.txt`);
  gpg([...faked, '--local-user', k.fpr, '--clearsign', '--output', hashes, plain]);
  return { hashes, tarball, sha };
}

function run(key: string, hashes: string, tarball: string, fpr: string, sha: string): { status: number; stderr: string } {
  const r = spawnSync('bash', [SCRIPT, key, hashes, tarball, fpr, sha], { encoding: 'utf8' });
  return { status: r.status ?? -1, stderr: r.stderr };
}

describe('verify-release.sh (offline)', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-release-'));
    home = mkdtempSync(join(tmpdir(), 'verify-gnupg-'));
  });
  afterAll(() => {
    spawnSync('gpgconf', ['--homedir', home, '--kill', 'all']);
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('accepts a good signature, hash line and tarball', () => {
    const k = makeKey('1y');
    const s = sign(k);
    const r = run(exportKey(k), s.hashes, s.tarball, k.fpr, s.sha);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('rejects a tampered hashes.txt', () => {
    const k = makeKey('1y');
    const s = sign(k);
    writeFileSync(s.hashes, readFileSync(s.hashes, 'utf8').replace(NAME, 'monero-evil.tar.bz2'));
    { const r = run(exportKey(k), s.hashes, s.tarball, k.fpr, s.sha); expect(r.status).toBe(1); expect(r.stderr).toMatch(/BADSIG/); }
  });

  it('rejects a tarball with one byte flipped', () => {
    const k = makeKey('1y');
    const s = sign(k);
    const bytes = readFileSync(s.tarball);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    writeFileSync(s.tarball, bytes);
    { const r = run(exportKey(k), s.hashes, s.tarball, k.fpr, s.sha); expect(r.status).toBe(1); expect(r.stderr).toMatch(/tarball sha256 mismatch/); }
  });

  it('rejects a different expected fingerprint (wrong key)', () => {
    const k = makeKey('1y');
    const other = makeKey('1y');
    const s = sign(k);
    { const r = run(exportKey(k), s.hashes, s.tarball, other.fpr, s.sha); expect(r.status).toBe(1); expect(r.stderr).toMatch(/key fingerprint is not/); }
  });

  it('rejects a missing or different hash line', () => {
    const k = makeKey('1y');
    const s = sign(k);
    const wrong = 'a'.repeat(64);
    { const r = run(exportKey(k), s.hashes, s.tarball, k.fpr, wrong); expect(r.status).toBe(1); expect(r.stderr).toMatch(/signed hashes do not list/); }
    const emptyPlain = join(dir, 'empty.txt');
    writeFileSync(emptyPlain, 'nothing here\n');
    const hashes = join(dir, 'hashes-empty.txt');
    gpg(['--local-user', k.fpr, '--clearsign', '--output', hashes, emptyPlain]);
    { const r = run(exportKey(k), hashes, s.tarball, k.fpr, s.sha); expect(r.status).toBe(1); expect(r.stderr).toMatch(/signed hashes do not list/); }
  });

  it('rejects an expired key', () => {
    const k = makeKey('1d', '20200101T000000');
    const s = sign(k, '20200101T120000');
    { const r = run(exportKey(k), s.hashes, s.tarball, k.fpr, s.sha); expect(r.status).toBe(1); expect(r.stderr).toMatch(/EXPKEYSIG/); }
  });

  it('rejects a revoked key', () => {
    const k = makeKey('1y');
    const s = sign(k);
    const rev = join(dir, `${k.fpr}.rev`);
    gpg(['--output', rev, '--gen-revoke', k.fpr], 'y\n0\n\ny\n');
    gpg(['--import', rev]);
    { const r = run(exportKey(k), s.hashes, s.tarball, k.fpr, s.sha); expect(r.status).toBe(1); expect(r.stderr).toMatch(/REVKEYSIG/); }
  });
});
