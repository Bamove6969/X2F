// TRIPWIRE for Plan 5 Task 15 (the review of wip/lead-proof-receive, 9 Nov 2026, F4). A received proof
// image is shown in one way only: <ProofThumb bytes declared alt /> (apps/web/src/screens/proof), which
// runs the receiving device's check (showableProof -> @x2f/proof's receiveProof: type allowlist, header
// walk, size cap, metadata stripped, decode, redraw on a fresh canvas) and shows the redrawn copy as a
// data: URL. The decrypted bytes never reach an <img>, a Blob URL, a FileReader or a download link, in
// the trader app or the staff app. ChatPanel's `proof.attached` card (screens/proof/ChatProof.tsx,
// wip/lead-proof-chat-receive) mounts ProofThumb with the decrypted bytes; the paid card's proof slot,
// DisputeRoom's evidence chips (seams.tsx: tradeProofs is empty) and the moderator's view are still
// Task 15's, and each mounts ProofThumb the same way, so the only <img> in either app stays
// ProofThumb's own. Extend IMG_ALLOWED only for an image that is not a proof (a logo or avatar from
// the app's own files), never for a proof.
// Proof stack: ChatPanel -> ChatProof -> ProofThumb is also asserted below (the chat's proof lines).
// Proof-receive review I3 (12 Nov 2026): a file that decrypts a proof also never sends anything out
// of the page (no fetch with a body, postMessage, sendBeacon, WebSocket or EventSource), so the
// plaintext can only go to ProofThumb.
// Re-verify of f8c9fa78 (10 Nov 2026, F-R1): the wire also catches the other ways to put bytes on the
// screen (createElement('img'), new Image(), HTML strings, SVG <image>, CSS url(), <video poster>,
// <input type="image">, any "data:" string literal), scans .js/.jsx/.mjs/.cjs too, and strips comments
// with a real parser (oxc, through the root devDependency rolldown), so a '//' inside a string or JSX
// text no longer hides the rest of the line.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'rolldown/utils';
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
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(name) && !/\.d\.[mc]?ts$/.test(name)) out.push(rel);
  }
  return out;
}

/**
 * The file's code, comments removed, so a comment that says "never an <img>" does not trip the wire.
 * The comments are the ones the parser finds, so '//' inside a string, a template, a regex or JSX text
 * stays code. Each comment becomes spaces (its line breaks kept). A file the parser cannot read fails.
 */
const parsed = new Map<string, string>();
function code(rel: string): string {
  const hit = parsed.get(rel);
  if (hit !== undefined) return hit;
  const src = readFileSync(`${ROOT}${rel}`, 'utf8');
  const { comments, errors } = parseSync(rel, src);
  expect(errors.map((e) => e.message), `${rel}: the tripwire cannot parse this file`).toEqual([]);
  let out = '';
  let at = 0;
  for (const c of [...comments].sort((a, b) => a.start - b.start)) {
    out += src.slice(at, c.start) + src.slice(c.start, c.end).replace(/[^\n]/g, ' ');
    at = c.end;
  }
  out += src.slice(at);
  parsed.set(rel, out);
  return out;
}

/** Tags that put a picture, a frame or media on the screen, as JSX or as createElement's tag name. */
const MEDIA_TAGS = 'img|image|feImage|picture|object|embed|iframe|frame|video|audio|source|track';

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
      expect(c, f).not.toMatch(/<(picture|object|embed|i?frame|image|feImage|video|audio|source|track)[\s/>]/);
      expect(c, f).not.toMatch(/\bsrc[sS]et\b/);
      expect(c, `${f}: <video poster> shows a picture`).not.toMatch(/\bposter=[{'"`]/);
      expect(c, `${f}: <input type="image"> shows a picture`).not.toMatch(/\btype\s*[=:]\s*\{?\s*['"`]image['"`]/);
    }
  });

  it('no element built outside JSX: no createElement of a media tag, no new Image(), no HTML from a string', () => {
    for (const f of files) {
      const c = code(f);
      expect(c, `${f}: createElement of a media tag`).not.toMatch(new RegExp(`\\bcreateElement(NS)?\\s*\\([^)]*?['"\`](${MEDIA_TAGS})['"\`]`, 'i'));
      expect(c, `${f}: new Image()`).not.toMatch(/\bnew\s+Image\s*\(/);
      expect(c, `${f}: HTML from a string`).not.toMatch(/\b(innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|createContextualFragment|DOMParser|srcdoc|srcDoc)\b|\bdocument\.write(ln)?\b/);
    }
  });

  it('no CSS picture: no url() and no *-image property in the TypeScript or JavaScript of either app', () => {
    for (const f of files) {
      const c = code(f);
      // url( in lower case anywhere (new URL( is not CSS), and in any case right after a quote or a colon.
      expect(c, `${f}: a CSS url() in code`).not.toMatch(/\burl\s*\(/);
      expect(c, `${f}: a CSS url() in a string`).not.toMatch(/['"`:]\s*url\s*\(/i);
      expect(c, `${f}: a CSS image property in code`).not.toMatch(/\b(backgroundImage|borderImage|borderImageSource|maskImage|WebkitMaskImage|listStyleImage)\b|-image\s*:/);
    }
  });

  it('no Blob URL, no FileReader data URL, no download link: the bytes have no way to the screen but the redraw', () => {
    for (const f of files) {
      const c = code(f);
      expect(c, f).not.toMatch(/createObjectURL|revokeObjectURL/);
      expect(c, f).not.toMatch(/readAsDataURL|readAsBinaryString/);
      expect(c, f).not.toMatch(/\bdownload(=|:)/);
      if (RECEIVE_PATH.includes(f)) continue;
      expect(c, `${f}: a data: image URL outside the receive path`).not.toMatch(/data:image\//);
      // Any string or template literal that starts "data:", so "data:" + "image/png" is caught too.
      expect(c, `${f}: a data: URL outside the receive path`).not.toMatch(/['"`]\s*data:/i);
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

  it("the chat's proof lines are wired: ChatPanel mounts ChatProof for a proof line, and ChatProof gives ProofThumb the decrypted bytes", () => {
    const panel = code('apps/web/src/chat/ChatPanel.tsx');
    expect(panel).toMatch(/import \{ ChatProof \} from '\.\.\/screens\/proof\/ChatProof\.js'/);
    expect(panel).toMatch(/l\.proof !== undefined \? \([\s\S]{0,200}<ChatProof tradeCode=\{tradeCode\} proof=\{l\.proof\} \/>/);
    const card = code('apps/web/src/screens/proof/ChatProof.tsx');
    expect(card).toMatch(/<ProofThumb\s+bytes=\{state\.bytes\}/);
    expect(card).toMatch(/\bdecryptProof\(/);
  });

  it('a file that decrypts a proof hands the bytes to ProofThumb, never to a Blob, a URL or an <img> of its own', () => {
    for (const f of files) {
      const c = code(f);
      if (!/\bdecryptProof\s*\(/.test(c)) continue;
      expect(c, `${f} decrypts a proof: show it with <ProofThumb>`).toMatch(/\bProofThumb\b/);
      expect(c, f).not.toMatch(/new Blob\(|new File\(|<img[\s/>]|data:image\//);
      // Review I3: and never out of the page.
      expect(c, `${f} decrypts a proof: it sends nothing out`).not.toMatch(/\bpostMessage\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b|\bbody\s*:/);
      // Re-verify R3: the shorthand `{ body }`, XMLHttpRequest, and writes to the browser's storage.
      expect(c, `${f} decrypts a proof: no shorthand body`).not.toMatch(/[{,]\s*body\s*[,}]/);
      expect(c, `${f} decrypts a proof: no XMLHttpRequest`).not.toMatch(/\bXMLHttpRequest\b/);
      expect(c, `${f} decrypts a proof: nothing stored`).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|caches)\b|\bdocument\.cookie\b/);
    }
  });
});
