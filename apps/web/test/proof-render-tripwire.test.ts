// TRIPWIRE for Plan 5 Task 15 (the review of wip/lead-proof-receive, 9 Nov 2026, F4). A received proof
// image is shown in one way only: <ProofThumb bytes declared alt /> (apps/web/src/screens/proof), which
// runs the receiving device's check (showableProof -> @x2f/proof's receiveProof: type allowlist, header
// walk, size cap, metadata stripped, decode, redraw on a fresh canvas) and shows the redrawn copy as a
// data: URL. The decrypted bytes never reach an <img>, a Blob URL, a FileReader or a download link, in
// the trader app or the staff app. Today nothing mounts ProofThumb: ChatPanel's `proof.attached` card,
// the paid card's proof slot, DisputeRoom's evidence chips (seams.tsx: tradeProofs is empty) and the
// moderator's view are Task 15's, so the only <img> in either app is ProofThumb's own. When Task 15
// lands, each of those places mounts ProofThumb with the decrypted bytes and the envelope's mime, width
// and height, and this test keeps passing without a change. Extend IMG_ALLOWED only for an image that
// is not a proof (a logo or avatar from the app's own files), never for a proof.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const APPS = ['apps/web/src', 'apps/staff-web/src'];
/** The one component that may render an <img>: ProofThumb, whose src is showableProof's redrawn copy. */
const PROOF_THUMB = 'apps/web/src/screens/proof/ProofThumb.tsx';
const IMG_ALLOWED = [PROOF_THUMB];
/** The receive path: the only files that may name the check or build a data: image URL. */
const RECEIVE_PATH = ['apps/web/src/proof/receive.ts', PROOF_THUMB];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(`${ROOT}${dir}`)) {
    const rel = `${dir}/${name}`;
    if (statSync(`${ROOT}${rel}`).isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(rel);
  }
  return out;
}

/** The file's code, comments removed, so a comment that says "never an <img>" does not trip the wire. */
function code(rel: string): string {
  return readFileSync(`${ROOT}${rel}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const files = APPS.flatMap(sources);

describe('Task 15 wiring: a proof image is shown only through ProofThumb', () => {
  it('scans both apps', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(PROOF_THUMB);
    expect(files).toContain('apps/web/src/proof/receive.ts');
    expect(files.some((f) => f.startsWith('apps/staff-web/src/'))).toBe(true);
  });

  it('no <img>, <picture>, <object>, <embed> or <iframe> outside ProofThumb, and no srcSet anywhere', () => {
    for (const f of files) {
      const c = code(f);
      if (!IMG_ALLOWED.includes(f)) expect(c, `${f}: an <img> outside ProofThumb; a proof image goes through <ProofThumb>`).not.toMatch(/<img[\s/>]/);
      expect(c, f).not.toMatch(/<(picture|object|embed|iframe)[\s/>]/);
      expect(c, f).not.toMatch(/\bsrc[sS]et\b/);
    }
  });

  it('no Blob URL, no FileReader data URL, no download link: the bytes have no way to the screen but the redraw', () => {
    for (const f of files) {
      const c = code(f);
      expect(c, f).not.toMatch(/createObjectURL|revokeObjectURL/);
      expect(c, f).not.toMatch(/readAsDataURL|readAsBinaryString/);
      expect(c, f).not.toMatch(/\bdownload(=|:)/);
      if (!RECEIVE_PATH.includes(f)) expect(c, `${f}: a data: image URL outside the receive path`).not.toMatch(/data:image\//);
    }
  });

  it("ProofThumb's <img> shows showableProof's redrawn copy and nothing else", () => {
    const c = code(PROOF_THUMB);
    expect(c).toMatch(/import \{[^}]*\bshowableProof\b[^}]*\} from '\.\.\/\.\.\/proof\/receive\.js'/);
    const imgs = c.match(/<img[^>]*>/g) ?? [];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatch(/src=\{state\.proof\.src\}/);
    // The received bytes reach showableProof only: no Blob, no URL, no other use of them.
    expect(c).not.toMatch(/new Blob\(|URL\.|btoa\(|base64/);
    expect(c.match(/\bbytes\b/g)!.length).toBe(4); // the prop and its type, showableProof's argument, the effect's dependency
  });

  it('the check is named only on the receive path: no other file builds its own way of showing a proof', () => {
    for (const f of files) {
      if (RECEIVE_PATH.includes(f)) continue;
      expect(code(f), `${f}: showableProof / receiveProof / browserReceiveDeps belong to the receive path; mount <ProofThumb> instead`).not.toMatch(/\b(showableProof|receiveProof|browserReceiveDeps)\b/);
    }
  });

  it('a file that decrypts a proof hands the bytes to ProofThumb, never to a Blob, a URL or an <img> of its own', () => {
    for (const f of files) {
      const c = code(f);
      if (!/\bdecryptProof\s*\(/.test(c)) continue;
      expect(c, `${f} decrypts a proof: show it with <ProofThumb>`).toMatch(/\bProofThumb\b/);
      expect(c, f).not.toMatch(/new Blob\(|new File\(|<img[\s/>]|data:image\//);
    }
  });
});
