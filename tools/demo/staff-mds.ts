/**
 * DEMO ONLY: the demo API's FIDO metadata folder (X2F_ATTESTATION_DIR), so the seeded staff
 * accounts can hold "hardware" security keys the demo makes in software.
 *
 * Staff and owner security keys must be attested by a key on the repo's allowlists
 * (apps/api/data/fido-mds, apps/api/src/auth/attestation.ts), and the owner's setup needs two of
 * them. The demo has no hardware, so it does what the regtest e2e stack does
 * (tools/regtest/e2e/softKey.ts): a throwaway attestation CA, made fresh on every start, whose test
 * AAGUID is put on both allowlists. Unlike the e2e stack, the demo's folder is a copy of the repo's
 * real snapshot with that one key added, so a real YubiKey still registers in the demo as it would
 * in production. The folder lives in .demo/state; the repo's snapshot is never changed, and nothing
 * outside tools/demo reads this one.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_AAGUID, newCa, writeMds, type CaData } from '../regtest/e2e/softKey.js';
import { ROOT } from './config.js';

export const REPO_MDS_DIR = join(ROOT, 'apps/api/data/fido-mds');

/** The README with the demo key's line added under both allowlist headings (each kept otherwise as is). */
export function demoMdsReadme(readme: string, aaguid = KEY_AAGUID): string {
  const line = `- \`${aaguid}\` X2F demo key (software, demo only)`;
  const text = readme.replace(/\r\n?/g, '\n');
  let out = text;
  for (const heading of ['Owner allowlist', 'Staff allowlist']) {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the two literal headings above
    const re = new RegExp(`^## ${heading}[ \\t]*\\n`, 'm');
    if (!re.test(out)) throw new Error(`demo: the FIDO metadata README has no "## ${heading}" section`);
    out = out.replace(re, (h) => `${h}\n${line}\n`);
  }
  return out;
}

/** Makes `dir` (replacing it): the repo's snapshot, the demo CA's statement, and the merged README. */
export async function makeDemoMds(dir: string, repoDir = REPO_MDS_DIR): Promise<CaData> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(repoDir, dir, { recursive: true });
  const readme = readFileSync(join(repoDir, 'README.md'), 'utf8');
  const ca = newCa();
  // The statement file (and a README naming only the test key, replaced just below).
  await writeMds(dir, ca);
  writeFileSync(join(dir, 'README.md'), demoMdsReadme(readme));
  return ca;
}
