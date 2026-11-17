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
// Review of proof-tripwire-3 (13 Nov 2026): ChatProof's import pin is read from the parser's module record
// (P-M1), `body ??=` / `||=` and a key held in a const are caught (P-M2), and a decrypting file uses no
// import.meta.glob, import() or re-export (P-I1).
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
/** Each file's module record from the same parse (its static imports, re-exports, import() calls and import.meta uses). */
const records = new Map<string, ModuleRecord>();
type ModuleRecord = ReturnType<typeof parseSync>['module'];
function code(rel: string): string {
  const hit = parsed.get(rel);
  if (hit !== undefined) return hit;
  const src = readFileSync(`${ROOT}${rel}`, 'utf8');
  const { comments, errors, module } = parseSync(rel, src);
  expect(errors.map((e) => e.message), `${rel}: the tripwire cannot parse this file`).toEqual([]);
  records.set(rel, module);
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
/** The parser's module record for a file (P-M1: imports are read from it, not from the text). */
function moduleOf(rel: string): ModuleRecord {
  code(rel);
  return records.get(rel)!;
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
    let gated = 0;
    for (const f of files) {
      const c = code(f);
      if (!decryptsAProof(c)) continue;
      gated++;
      // Re-verify V-M1: naming decryptProof at all (an alias, .call, a re-export) is for ChatProof only.
      expect(DECRYPT_ALLOWED, `${f} names decryptProof: only ChatProof decrypts a proof`).toContain(f);
      expect(c, `${f} decrypts a proof: show it with <ProofThumb>`).toMatch(/\bProofThumb\b/);
      expect(c, f).not.toMatch(/new Blob\(|new File\(|<img[\s/>]|data:image\//);
      // Review I3, re-verify R3 and V-M2: and never out of the page.
      expect(sendsOut(c), `${f} decrypts a proof: it sends nothing out and stores nothing`).toEqual([]);
      // P-I1: and pulls in no module the import pin cannot see (import.meta.glob, import(), a re-export).
      expect(otherModuleReach(moduleOf(f), c), `${f} decrypts a proof: no import.meta.glob, import() or re-export`).toEqual([]);
    }
    expect(gated, 'the gate still finds ChatProof').toBe(DECRYPT_ALLOWED.length);
  });
});

/** The one file that may decrypt a proof (it mounts ProofThumb with the plaintext). */
const DECRYPT_ALLOWED = ['apps/web/src/screens/proof/ChatProof.tsx'];

/** Re-verify V-M1: any mention of the name, so an aliased import, `.call` or a re-export is checked too. */
function decryptsAProof(c: string): boolean {
  return /\bdecryptProof\b/.test(c);
}

/** Each way out of the page (or into storage) a decrypting file must not use, by name. */
const OUT_RULES: readonly [string, RegExp][] = [
  ['a channel out (postMessage, sendBeacon, WebSocket, EventSource)', /\bpostMessage\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b/],
  ['a request body (`body:`)', /\bbody\s*:/],
  ['a shorthand body (`{ body }`)', /[{,]\s*body\s*[,}]/],
  // V-M2: a body set after the object is built (`init.body = …`), never a comparison (`res.body === null`).
  // P-M2: the logical assignments too (`init.body ??= …`, `||=`, `&&=`).
  ['a body assigned (`.body =`, `. body =`, `.body ??=`, `||=`, `&&=`)', /\.\s*body\s*(?:\?\?|\|\||&&)?=(?!=)/],
  // T-M2, P-M2: "body" as a string at all: a quoted key, an argument (Reflect.set, Object.defineProperty,
  // Object.fromEntries) or a const that holds it for a computed key later.
  ['a "body" string (a quoted key, an argument, or a const that holds it)', /(['"`])\s*body\s*\1/],
  ['a computed key (`{ [k]: … }`)', /[{,]\s*\[[^\]\n]+\]\s*:/],
  // P-M2: a key built elsewhere and set by index (`init[k] = …`, `??=`), or by a property-setting call.
  // (A member index only: `const [a, b] = …` and `[a, b] = [b, a]` are destructuring, and `T[] = …` a type.)
  ['an indexed assignment (`x[k] = …`)', /(?<!\b(?:const|let|var)\s*)(?<=[\w$)\]]\s*)\[[^\]\n]+\]\s*(?:\?\?|\|\||&&)?=(?!=)/],
  ['a property set by a call (Reflect.set / defineProperty, Object.defineProperty / defineProperties / fromEntries)', /\bReflect\s*\.\s*(set|defineProperty)\b|\bObject\s*\.\s*(defineProperty|defineProperties|fromEntries)\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['storage (local/session storage, IndexedDB, caches, cookieStore, document.cookie or document[…])', /\b(localStorage|sessionStorage|indexedDB|caches|cookieStore)\b|\bdocument\s*(\.\s*cookie\b|\[)/],
];

function sendsOut(c: string): string[] {
  return OUT_RULES.filter(([, re]) => re.test(c)).map(([name]) => name);
}

/**
 * T-M1 (lead): ChatProof's imports, pinned. The plaintext can only reach what ChatProof imports, so a
 * new import (a helper that could receive the bytes) fails here and has to be reviewed first.
 */
const CHATPROOF_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  '@x2f/proof': ['PROOF_MAX_CIPHERTEXT', 'ProofAttachedPayload', 'ReceiveDeps', 'decryptProof', 'proofKeyFromBase64'],
  '../../proof/chatProof.js': ['noteProofChecked'],
  react: ['useEffect', 'useRef', 'useState'],
  '../../ui/Notice.js': ['Notice'],
  './ProofThumb.js': ['PROOF_CHECKING', 'PROOF_REFUSED_BODY', 'PROOF_REFUSED_TITLE', 'ProofThumb'],
};

/**
 * P-M1: a file's static imports as { specifier: sorted names }, read from the parser's module record (so a
 * multi-line, a mid-line or an `import x, { y }` import is read as the module system reads it). A renamed
 * import reads `name as local`; a namespace, default or side-effect import is named by its form.
 */
function importsOf(m: ModuleRecord): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const imp of m.staticImports) {
    const names = (out[imp.moduleRequest.value] ??= []);
    if (imp.entries.length === 0) names.push('(side effect)');
    for (const e of imp.entries) {
      const local = e.localName.value;
      if (e.importName.kind === 'NamespaceObject') names.push(`(namespace ${local})`);
      else if (e.importName.kind === 'Default') names.push(`(default ${local})`);
      else names.push(e.importName.name === local ? local : `${e.importName.name} as ${local}`);
    }
  }
  for (const k of Object.keys(out)) out[k]!.sort();
  return out;
}

/** P-M1, P-I1: the other ways a module reaches code: a re-export, an import() call, or an import.meta use that is not `import.meta.env.NAME`. */
function otherModuleReach(m: ModuleRecord, c: string): string[] {
  const out: string[] = [];
  for (const e of m.staticExports) for (const x of e.entries) if (x.moduleRequest !== null && x.moduleRequest !== undefined) out.push(`re-export from ${x.moduleRequest.value}`);
  for (const d of m.dynamicImports) out.push(`import() at ${d.start}`);
  // P-I1: import.meta.glob (and .globEager, an alias of import.meta, import.meta['glob']) pulls in modules
  // the pin never sees; only a plain env read (`import.meta.env.VITE_…`) is allowed.
  for (const im of m.importMetas) if (!/^\s*\.\s*env\s*\.\s*[A-Za-z_$][\w$]*/.test(c.slice(im.end))) out.push(`import.meta at ${im.start}: ${c.slice(im.start, im.end + 24).replace(/\s+/g, ' ')}`);
  return out;
}

/** A snippet's module record and its code, for the rules' own tests. */
function parseSnippet(src: string): { m: ModuleRecord; c: string } {
  const { module, errors } = parseSync('snippet.ts', src);
  expect(errors.map((e) => e.message), src).toEqual([]);
  return { m: module, c: src };
}

describe('T-M1: what ChatProof (the one decrypting file) imports is pinned', () => {
  it('exactly this list: any new import needs review first', () => {
    const f = 'apps/web/src/screens/proof/ChatProof.tsx';
    const want = Object.fromEntries(Object.entries(CHATPROOF_IMPORTS).map(([k, v]) => [k, [...v].sort()]));
    expect(importsOf(moduleOf(f))).toEqual(want);
    expect(otherModuleReach(moduleOf(f), code(f)), 'no re-export, import() or import.meta in ChatProof').toEqual([]);
    expect(code(f), 'no require in ChatProof').not.toMatch(/\brequire\s*\(/);
  });

  it('the pin reads every import form, as the parser does (P-M1)', () => {
    const { m } = parseSnippet(
      "import { send } from './helper.js';\nimport * as h from './h.js';\nimport './side.js';\nimport d from './d.js';\n" +
        "import {\n  a,\n  type B,\n  c as e,\n} from './multi.js'; import { late } from './same-line.js';\nimport d2, { more } from './both.js';",
    );
    expect(importsOf(m)).toEqual({
      './helper.js': ['send'], './h.js': ['(namespace h)'], './side.js': ['(side effect)'], './d.js': ['(default d)'],
      './multi.js': ['B', 'a', 'c as e'], './same-line.js': ['late'], './both.js': ['(default d2)', 'more'],
    });
  });

  it('a re-export, an import() and an import.meta.glob are caught; an env read is not (P-M1, P-I1)', () => {
    for (const src of [
      "export { send } from './helper.js';",
      "export * from './helper.js';",
      "const h = await import('./helper.js');",
      "const mods = import.meta.glob('./*.ts', { eager: true });",
      "const mods = import.meta.globEager('./*.ts');",
      "const m = import.meta;\nconst mods = m.glob('./*.ts');",
      "const mods = import.meta['glob']('./*.ts');",
      "const mods = import . meta . glob('./*.ts');",
    ]) {
      const { m, c } = parseSnippet(src);
      expect(otherModuleReach(m, c), src).not.toEqual([]);
    }
    const { m, c } = parseSnippet("const on = import.meta.env.VITE_X2F_PROOF_UPLOAD === '1';");
    expect(otherModuleReach(m, c)).toEqual([]);
  });
});

describe('the decrypt rules themselves (re-verify V-M1, V-M2)', () => {
  it('V-M1: an aliased import, a .call and a re-export of decryptProof are all gated', () => {
    for (const snippet of [
      "import { decryptProof as open } from '@x2f/proof';\nconst plain = await open(c, k, a);",
      'const plain = await decryptProof.call(null, c, k, a);',
      "export { decryptProof } from '@x2f/proof';",
      "import * as proof from '@x2f/proof';\nconst plain = await proof['decryptProof'](c, k, a);",
    ]) expect(decryptsAProof(snippet), snippet).toBe(true);
  });

  it('V-M2: a body set afterwards, quoted or computed keys, cookieStore and document[…] are caught', () => {
    for (const snippet of [
      "const init: RequestInit = { method: 'POST' };\ninit.body = plain;\nawait fetch(u, init);",
      "init['body'] = plain;",
      "await fetch(u, { method: 'POST', 'body': plain });",
      'await fetch(u, { method: "POST", ["body"]: plain });',
      "const k = 'bo' + 'dy';\nawait fetch(u, { method: 'POST', [k]: plain });",
      "await cookieStore.set('p', text);",
      "document['cookie'] = text;",
      'document .cookie = text;',
      "await fetch(u, { method: 'POST', body });",
    ]) expect(sendsOut(snippet), snippet).not.toEqual([]);
  });

  it('T-M2: Reflect.set, Object.defineProperty and Object.fromEntries with a body, and `. body =`, are caught', () => {
    for (const snippet of [
      "Reflect.set(init, 'body', plain);",
      "Object.defineProperty(init, 'body', { value: plain });",
      "const init = Object.fromEntries([['method', 'POST'], ['body', plain]]);",
      'init. body = plain;',
      'init .body= plain;',
    ]) expect(sendsOut(snippet), snippet).not.toEqual([]);
  });

  it('P-M2: `body ??=`, `body ||=`, `&&=` and a key from a const that holds "body" are caught', () => {
    for (const snippet of [
      'init.body ??= plain;',
      'init.body ||= plain;',
      'init.body &&= plain;',
      "init['body'] ??= plain;",
      "const K = 'body';\ninit[K] = plain;",
      'const K = `body`;\nReflect.set(init, K, plain);',
      "const K = 'bo' + 'dy';\ninit[K] = plain;",
      "const K = 'bo' + 'dy';\ninit[K] ??= plain;",
      "const K = 'bo' + 'dy';\nReflect.set(init, K, plain);",
      "const K = 'bo' + 'dy';\nObject.defineProperty(init, K, { value: plain });",
      "const K = 'bo' + 'dy';\nconst init = Object.fromEntries([['method', 'POST'], [K, plain]]);",
    ]) expect(sendsOut(snippet), snippet).not.toEqual([]);
  });

  it("does not trip on reading a response body (ChatProof's own readCapped)", () => {
    for (const snippet of ['void res.body?.cancel().catch(() => undefined);', 'if (res.body === null) return new Uint8Array(0);', 'const reader = res.body.getReader();', 'if (res.body !== null) n++;', 'const [state, setState] = useState(0);', 'let [a, b] = pair;\n[a, b] = [b, a];', 'if (parts[0] === undefined) n++;', 'const parts: Uint8Array[] = [];']) {
      expect(sendsOut(snippet), snippet).toEqual([]);
    }
    expect(sendsOut(code('apps/web/src/screens/proof/ChatProof.tsx'))).toEqual([]);
  });
});
