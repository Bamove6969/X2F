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
// Review of proof-tripwire-4 (17 Nov 2026): the body, key and call rules read the parser's tree, not the
// text (PTW4-M1, M2, M3, I4): `treeOut` below.
// Review of proof-tripwire-5 (17 Nov 2026): code or a key built at run time (JSON.parse, structuredClone,
// Proxy, Function, eval, atob, `.constructor`, `.__proto__`, `.__defineGetter__`) and a computed member
// with a key that is not a static literal are caught too, as tree rules (PTW5-M1, M2).
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
/**
 * Lead call (train-1 merge, 18 Nov 2026): the profile's "save record" link. Record.tsx saves the user's
 * own signed text record (Plan 5 Task 12) and never a proof image, so it alone may hold one
 * `data:text/plain;charset=utf-8,` URL and one `download` attribute. Any other data: type, a Blob URL, a
 * FileReader, a second download link, or an import from proof/ or chat/ in that file still trips the wire.
 */
const SAVE_RECORD = 'apps/web/src/screens/profile/Record.tsx';
const SAVE_RECORD_URL = '`data:text/plain;charset=utf-8,';
const SAVE_RECORD_DOWNLOAD = /\bdownload=\{/g;
/** The file's code with the save-record link's one URL prefix and one download attribute taken out (SAVE_RECORD only). */
function withoutSaveRecord(rel: string, c: string): string {
  if (rel !== SAVE_RECORD) return c;
  // The first of each only: a second text/plain URL or download attribute still trips the wire.
  return c.replace(SAVE_RECORD_URL, '`').replace(/\bdownload=\{/, '{');
}
/** What puts a proof's bytes on the screen or in a file by a way other than ProofThumb's redraw. */
function byteWays(rel: string, c: string): string[] {
  const out: string[] = [];
  if (/createObjectURL|revokeObjectURL/.test(c)) out.push('a Blob URL');
  if (/readAsDataURL|readAsBinaryString/.test(c)) out.push('a FileReader data URL');
  if (/\bdownload(=|:)/.test(c)) out.push('a download link');
  if (RECEIVE_PATH.includes(rel)) return out;
  if (/data:image\//.test(c)) out.push('a data: image URL outside the receive path');
  // Any string or template literal that starts "data:", so "data:" + "image/png" is caught too.
  if (/['"`]\s*data:/i.test(c)) out.push('a data: URL outside the receive path');
  return out;
}

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
/** And its tree (PTW4: the body, key and call rules walk it). */
const programs = new Map<string, Program>();
type ModuleRecord = ReturnType<typeof parseSync>['module'];
type Program = ReturnType<typeof parseSync>['program'];
function code(rel: string): string {
  const hit = parsed.get(rel);
  if (hit !== undefined) return hit;
  const src = readFileSync(`${ROOT}${rel}`, 'utf8');
  const { comments, errors, module, program } = parseSync(rel, src);
  expect(errors.map((e) => e.message), `${rel}: the tripwire cannot parse this file`).toEqual([]);
  records.set(rel, module);
  programs.set(rel, program);
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
/** The parser's tree for a file (PTW4: the body, key and call rules walk it). */
function programOf(rel: string): Program {
  code(rel);
  return programs.get(rel)!;
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
    // Sign-up v2's one download link is X2F's public signing key, a static file the API serves
    // (`/.well-known/x2f-signing-key.asc`): no proof bytes. Any other download link still fails.
    for (const f of files) expect(byteWays(f, withoutSaveRecord(f, code(f)).replace('download="x2f-signing-key.asc"', '')), f).toEqual([]);
  });

  it("the save-record exemption is Record.tsx's one text/plain link only, and the file reaches no proof or chat code", () => {
    expect(files).toContain(SAVE_RECORD);
    const c = code(SAVE_RECORD);
    expect(c.split(SAVE_RECORD_URL).length - 1, 'one text/plain data: URL').toBe(1);
    expect(c.match(SAVE_RECORD_DOWNLOAD)?.length, 'one download attribute').toBe(1);
    const reach = Object.keys(importsOf(moduleOf(SAVE_RECORD))).filter((s) => /(^|\/)(proof|chat)(\/|$)/.test(s));
    expect(reach, `${SAVE_RECORD} imports proof/ or chat/ code`).toEqual([]);
    expect(otherModuleReach(moduleOf(SAVE_RECORD), c)).toEqual([]);
  });

  it('must still trip: the exemption lets no other data: type, Blob URL or download through Record.tsx', () => {
    const c = code(SAVE_RECORD);
    const add = (extra: string) => byteWays(SAVE_RECORD, withoutSaveRecord(SAVE_RECORD, `${c}\n${extra}\n`));
    expect(add('')).toEqual([]);
    expect(add("const shot = 'data:image/png;base64,AAAA';")).toEqual(['a data: image URL outside the receive path', 'a data: URL outside the receive path']);
    expect(add('const shot = `data:image/webp,${x}`;')).toContain('a data: image URL outside the receive path');
    expect(add('const t = `data:text/html,${x}`;')).toEqual(['a data: URL outside the receive path']);
    expect(add("const t = 'data:text/plain;charset=utf-8,' + x;")).toEqual(['a data: URL outside the receive path']);
    expect(add('const u = URL.createObjectURL(blob);')).toEqual(['a Blob URL']);
    expect(add('r.readAsDataURL(blob);')).toEqual(['a FileReader data URL']);
    expect(add("const a = { download: 'proof.png' };")).toEqual(['a download link']);
    expect(add('const b = <a href={h} download={n}>x</a>;')).toEqual(['a download link']);
    expect(add('const t = `data:text/plain;charset=utf-8,${x}`;')).toEqual(['a data: URL outside the receive path']);
    // The same file name anywhere else gets no exemption.
    expect(byteWays('apps/web/src/screens/profile/Other.tsx', withoutSaveRecord('apps/web/src/screens/profile/Other.tsx', c))).not.toEqual([]);
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
      expect(sendsOut(c, programOf(f)), `${f} decrypts a proof: it sends nothing out and stores nothing`).toEqual([]);
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

/**
 * Every rule a decrypting file breaks: the text rules above, then the tree rules (PTW4). A snippet is
 * parsed here; a file passes the tree from its own parse.
 */
function sendsOut(c: string, program: Program = snippetProgram(c)): string[] {
  return [...textOut(c), ...treeOut(program)];
}
/**
 * The text rules (OUT_RULES). The body, key and call rules among them are the older text forms, kept so
 * nothing they caught is lost; treeOut is what closes those classes (PTW4). Add no new regex for them.
 */
function textOut(c: string): string[] {
  return OUT_RULES.filter(([, re]) => re.test(c)).map(([name]) => name);
}

/**
 * Review of proof-tripwire-4 (PTW4-M1, M2, M3, I4): the body, key and call rules read the parser's tree,
 * not the text, so an operator, a line break, a nested index, an alias, a bracket or a Unicode escape
 * changes nothing (the parser's names and string values are already unescaped).
 * - `body` (an identifier, a property key, a string, anywhere) is allowed only as a read of a member
 *   (`res.body.getReader()`, `res.body?.cancel()`, `res.body === null`): any write (any assignment
 *   operator, ++/--, a destructuring or for-in/for-of target, delete), key, getter, field or binding fails.
 * - A computed key (object literal, pattern, getter, method, class field) and a computed member write
 *   fail unless the key is a static literal that is not "body".
 * - `Reflect` and `Object` are not named at all (ChatProof uses neither).
 * - PTW5-M1: code or a key built at run time. `structuredClone`, `Proxy`, `Function`, `eval` and `atob` are
 *   not named at all; `JSON` only as `JSON.<a static key other than parse>`; and `__defineGetter__`,
 *   `__defineSetter__`, `__proto__` and `constructor` are never a member (`x.constructor`, `x['__proto__']`)
 *   or a destructured key (`const { constructor: C } = x`). A class's `constructor() {}` is a method key
 *   and is not a member.
 * - PTW5-M2: a computed member (read or written) whose key is not a static literal fails unless its object
 *   is `CHAT_PROOF_TITLE` (ChatProof's one: `CHAT_PROOF_TITLE[proof.kind]`), so no split-string bracket
 *   reaches a channel, storage or a banned global (`navigator['send' + 'Beacon']`).
 */
type Node = { type: string; [k: string]: unknown };

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && typeof (v as Node).type === 'string';
/** Nodes that only wrap an expression: the context is the first node above them. */
const WRAPPERS = new Set(['ParenthesizedExpression', 'ChainExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression']);
const COMPARE = new Set(['===', '!==', '==', '!=']);
const BANNED_NAMES = new Set(['Reflect', 'Object']);
/** PTW5-M1: what builds code or a key at run time; ChatProof names none of them. */
const RUNTIME_NAMES = new Set(['structuredClone', 'Proxy', 'Function', 'eval', 'atob']);
/** PTW5-M1: members that reach Object or set a getter without naming either. */
const BANNED_MEMBERS = new Set(['__defineGetter__', '__defineSetter__', '__proto__', 'constructor']);
/** PTW5-M2: the only objects a decrypting file may index with a key that is not a static literal. */
const DYNAMIC_INDEX_ALLOWED = new Set(['CHAT_PROOF_TITLE']);

/** A node's static string or number value (a literal or a template with no `${}`), or undefined. */
function staticValue(n: Node): string | undefined {
  if (n.type === 'Literal' && (typeof n.value === 'string' || typeof n.value === 'number')) return String(n.value);
  if (n.type === 'TemplateLiteral' && (n.expressions as Node[]).length === 0) return String((n.quasis as { value: { cooked: string | null } }[])[0]?.value.cooked ?? '');
  return undefined;
}
/** A computed key is allowed only when it is a static literal that is not "body". */
const staticNonBody = (key: Node): boolean => {
  const v = staticValue(key);
  return v !== undefined && v.trim() !== 'body';
};
/** The name a node spells, if it is a name (identifier, private name, JSX name). */
const nameOf = (n: Node): string | undefined => (n.type === 'Identifier' || n.type === 'PrivateIdentifier' || n.type === 'JSXIdentifier' ? (n.name as string) : undefined);

/** A member's key: its name, or a computed key's static value; undefined for a key built at run time. */
const memberKey = (m: Node): string | undefined => (m.computed === true ? staticValue(m.property as Node) : nameOf(m.property as Node))?.trim();
/** A property's key (object literal or pattern), the same way. */
const propertyKey = (p: Node): string | undefined => (p.computed === true ? staticValue(p.key as Node) : (nameOf(p.key as Node) ?? staticValue(p.key as Node)))?.trim();

/** Is `child` (under `parents`, nearest last) written to: an assignment, ++/--, delete, a for-in/of or destructuring target? */
function isWritten(child: Node, parents: Node[]): boolean {
  let c = child;
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i]!;
    if (WRAPPERS.has(p.type)) {
      c = p;
      continue;
    }
    switch (p.type) {
      case 'AssignmentExpression':
        return p.left === c;
      case 'UpdateExpression':
        return true;
      case 'UnaryExpression':
        return p.operator === 'delete';
      case 'ForInStatement':
      case 'ForOfStatement':
        return p.left === c;
      // A pattern is a target all the way up: climb to what the pattern is assigned by.
      case 'ArrayPattern':
      case 'ObjectPattern':
      case 'RestElement':
        c = p;
        continue;
      case 'AssignmentPattern':
        if (p.left !== c) return false;
        c = p;
        continue;
      case 'Property': {
        const pp = parents[i - 1];
        if (pp?.type === 'ObjectPattern' && p.value === c) {
          c = p;
          continue;
        }
        return false;
      }
      default:
        return false;
    }
  }
  return false;
}

/** Is the member `m` only read: the object of another member, or a side of a comparison? */
function isOnlyRead(m: Node, parents: Node[]): boolean {
  let c = m;
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i]!;
    if (WRAPPERS.has(p.type)) {
      c = p;
      continue;
    }
    if (p.type === 'MemberExpression') return p.object === c;
    if (p.type === 'BinaryExpression') return COMPARE.has(p.operator as string);
    return false;
  }
  return false;
}

/** What a decrypting file's tree does that the body, key and call rules forbid (PTW4). */
function treeOut(program: Program): string[] {
  const out = new Set<string>();
  const parents: Node[] = [];
  const visit = (n: Node): void => {
    const parent = parents[parents.length - 1];
    // `body` as a name anywhere but the property of a member that is only read.
    const name = nameOf(n);
    if (name === 'body') {
      const readMember = parent?.type === 'MemberExpression' && parent.property === n && parent.computed === false && isOnlyRead(parent, parents.slice(0, -1));
      if (!readMember) out.add('`body` used other than as a read of a member (a write, a key, a getter, a field or a binding)');
    }
    // "body" as a string at all (a quoted key, an index, an argument, a const that holds it).
    const v = staticValue(n);
    if (v !== undefined && v.trim() === 'body') out.add('a "body" string');
    // Reflect and Object, by any reference (an alias, a bracket, globalThis.Object), or as a string.
    if ((name !== undefined && BANNED_NAMES.has(name)) || (v !== undefined && BANNED_NAMES.has(v.trim()))) out.add('Reflect or Object named');
    // PTW5-M1: structuredClone, Proxy, Function, eval and atob by any reference, or as a string.
    if ((name !== undefined && RUNTIME_NAMES.has(name)) || (v !== undefined && RUNTIME_NAMES.has(v.trim()))) out.add('code or a key built at run time (structuredClone, Proxy, Function, eval, atob)');
    // PTW5-M1: JSON only as the object of a member with a static key that is not parse (so no alias,
    // no destructuring, no `globalThis.JSON`, no `JSON['parse']`).
    if (name === 'JSON' || v?.trim() === 'JSON') {
      const key = parent?.type === 'MemberExpression' && parent.object === n ? memberKey(parent) : undefined;
      if (key === undefined || key === 'parse') out.add('JSON.parse, or JSON by a reference that can reach it');
    }
    // PTW5-M1: __defineGetter__, __defineSetter__, __proto__ and constructor as a member or a destructured key.
    const member = n.type === 'MemberExpression' ? memberKey(n) : n.type === 'Property' && parent?.type === 'ObjectPattern' ? propertyKey(n) : undefined;
    if (member !== undefined && BANNED_MEMBERS.has(member)) out.add('__defineGetter__, __defineSetter__, __proto__ or constructor used as a member');
    // PTW5-M2: a computed member, read or written, whose key is not a static literal, unless its object is allowed.
    if (n.type === 'MemberExpression' && n.computed === true && staticValue(n.property as Node) === undefined) {
      const obj = nameOf(n.object as Node);
      if (!((n.object as Node).type === 'Identifier' && obj !== undefined && DYNAMIC_INDEX_ALLOWED.has(obj))) out.add('a computed member whose key is not a static literal');
    }
    // A computed key in an object literal or pattern, a getter or setter, a method or a class field.
    if ((n.type === 'Property' || n.type === 'PropertyDefinition' || n.type === 'MethodDefinition' || n.type === 'AccessorProperty' || n.type === 'TSPropertySignature' || n.type === 'TSMethodSignature') && n.computed === true && !staticNonBody(n.key as Node)) {
      out.add('a computed key that is not a static literal');
    }
    // A computed member written to (any operator, ++/--, delete, a destructuring or for-in/of target).
    if (n.type === 'MemberExpression' && n.computed === true && !staticNonBody(n.property as Node) && isWritten(n, parents)) out.add('a computed member written to');
    parents.push(n);
    for (const [k, child] of Object.entries(n)) {
      if (k === 'type') continue;
      if (Array.isArray(child)) {
        for (const c of child) if (isNode(c)) visit(c);
      } else if (isNode(child)) visit(child);
    }
    parents.pop();
  };
  visit(program as unknown as Node);
  return [...out];
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

/**
 * A snippet's tree, for the rules' own tests. A snippet that is a function's body (a bare `return`) is
 * parsed inside one.
 */
function snippetProgram(src: string): Program {
  const first = parseSync('snippet.ts', src);
  if (first.errors.length === 0) return first.program;
  const wrapped = parseSync('snippet.ts', `async function snippet() {\n${src}\n}`);
  expect(wrapped.errors.map((e) => e.message), src).toEqual([]);
  return wrapped.program;
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

  // Review of proof-tripwire-4 (17 Nov 2026), rows 1 to 13: each passed the text rules. K is 'bo' + 'dy'.
  const K = "const K = 'bo' + 'dy';\n";
  const PTW4_BYPASSES: readonly [string, string][] = [
    ['1 (M1)', 'init.body += plain;'],
    ['2 (M3)', `${K}init[K] += plain;`],
    ['3 (M1)', '({ x: init.body } = { x: plain });'],
    ['4 (M1)', '[init.body] = [plain];'],
    ['5 (M1)', 'for (init.body of [plain]);'],
    ['6 (M2)', `${K}Object.assign(init, { get [K]() { return plain; } });`],
    ['7 (M2)', `${K}await fetch(u, { method: 'POST', get [K]() { return plain; } });`],
    ['8 (M2)', `${K}class I { method = 'POST'; [K] = plain; }\nawait fetch(u, new I());`],
    ['9 (M3)', `${K}init[\n  K\n] = plain;`],
    ['10 (M3)', "const k = ['bo' + 'dy'];\ninit[k[0]] = plain;"],
    ['11 (M3) Reflect alias', `${K}const R = Reflect;\nR.set(init, K, plain);`],
    ['11 (M3) Object alias', `${K}const O = Object;\nO.defineProperty(init, K, { value: plain });`],
    ['12 (M3) Reflect bracket', `${K}Reflect['set'](init, K, plain);`],
    ['12 (M3) Object bracket', `${K}const init = Object['fromEntries']([['method', 'POST'], [K, plain]]);`],
    ['13 (I4) escaped key', 'await fetch(u, { \\u0062ody: plain });'],
    ['13 (I4) escaped member', 'init.\\u0062ody = plain;'],
  ];

  for (const [row, snippet] of PTW4_BYPASSES) {
    it(`PTW4 row ${row} is caught: ${snippet.replace(/\n/g, ' ')}`, () => {
      expect(sendsOut(snippet), snippet).not.toEqual([]);
      // By the tree rules on their own: no regex is needed for it.
      expect(treeOut(snippetProgram(snippet)), snippet).not.toEqual([]);
    });
  }

  it('PTW4: the tree rules alone catch every body, key and call snippet the text rules were written for', () => {
    for (const snippet of [
      "const init: RequestInit = { method: 'POST' };\ninit.body = plain;\nawait fetch(u, init);",
      "init['body'] = plain;",
      "await fetch(u, { method: 'POST', 'body': plain });",
      'await fetch(u, { method: "POST", ["body"]: plain });',
      "const k = 'bo' + 'dy';\nawait fetch(u, { method: 'POST', [k]: plain });",
      "await fetch(u, { method: 'POST', body });",
      "await fetch(u, { method: 'POST', body: plain });",
      "Reflect.set(init, 'body', plain);",
      "Object.defineProperty(init, 'body', { value: plain });",
      "const init = Object.fromEntries([['method', 'POST'], ['body', plain]]);",
      'init. body = plain;',
      'init .body= plain;',
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
      "Object.assign(init, { [K]: plain });",
      // (`init?.body ??= plain` is not here: an optional chain cannot be assigned to, so it never parses or runs.)
      "await fetch(u, { ...{ [K]: plain } });",
    ]) expect(treeOut(snippetProgram(snippet)), snippet).not.toEqual([]);
  });

  it('PTW4: every other write to `body`, every non-static computed key or member write, and any Reflect or Object, are caught', () => {
    const K = "const K = 'bo' + 'dy';\n";
    for (const snippet of [
      // A write to a member named body, of any form.
      'init.body++;',
      '--init.body;',
      'init.body -= plain;',
      'init.body **= plain;',
      'init.body >>>= plain;',
      'for (init.body in o);',
      '({ x: init.body = plain } = {});',
      '({ ...init.body } = o);',
      '[...init.body] = p;',
      '[, init.body] = [0, plain];',
      'delete init.body;',
      '(init.body as unknown) = plain;',
      'init!.body = plain;',
      '(init.body) = plain;',
      'class C { #body = 0; m() { this.#body = plain; } }',
      'const b = res.body;',
      // body as a key, a getter, a field, a binding.
      'const o = { get body() { return plain; } };',
      'const o = { set body(v) {} };',
      "const o = { get ['body']() { return plain; } };",
      'class C { body = plain; }',
      'class C { get body() { return plain; } }',
      'class C { static body = plain; }',
      'const { body } = res;',
      'const o = { body() { return plain; } };',
      'const o = { "\\u0062ody": plain };',
      "init['\\x62ody'] = plain;",
      // A computed key or member write whose key is not a static non-body literal.
      `${K}[init[K]] = [plain];`,
      `${K}for (init[K] of [plain]);`,
      `${K}for (init[K] in o);`,
      `${K}({ x: init[K] } = { x: plain });`,
      `${K}init[K]++;`,
      `${K}delete init[K];`,
      `${K}(init as Record<string, unknown>)[K] = plain;`,
      `${K}init[\`\${K}\`] = plain;`,
      `${K}class I { set [K](v: unknown) {} }`,
      `${K}class I { static [K] = plain; }`,
      `${K}class I { [K]() { return plain; } }`,
      `${K}const o = { [K]() { return plain; } };`,
      `${K}const { [K]: x } = o;`,
      // Reflect and Object by any reference.
      '\\u0052eflect.set(init, k, plain);',
      'const O = globalThis.Object;',
      "const R = globalThis['Reflect'];",
      'const { set } = Reflect;',
      'fn(Object);',
    ]) expect(treeOut(snippetProgram(snippet)), snippet).not.toEqual([]);
  });

  // Review of proof-tripwire-5 (17 Nov 2026), section 2 rows 1 to 16 and 21: each passed both the text and
  // the tree rules of 37d1b701 (code or a key built at run time, a split-string bracket). K is 'bo' + 'dy'.
  const J = String.raw`'{"bo' + 'dy":' + JSON.stringify(plain) + '}'`;
  const JM = String.raw`'{"method":"POST","bo' + 'dy":' + JSON.stringify(plain) + '}'`;
  const PTW5_BYPASSES: readonly [string, string][] = [
    ['1 (M1) JSON.parse spread', `await fetch(u, { method: 'POST', ...JSON.parse(${J}) });`],
    ['2 (M1) JSON.parse init', `await fetch(u, JSON.parse(${JM}));`],
    ['3 (M1) JSON escape', String.raw`await fetch(u, { method: 'POST', ...JSON.parse('{"b\\u006fdy":' + JSON.stringify(plain) + '}') });`],
    ['4 (M1) structuredClone', `await fetch(u, structuredClone(JSON.parse(${JM})));`],
    ['5 (M1) Proxy', `${K}await fetch(u, new Proxy({ method: 'POST' }, { get: (t, k) => (k === K ? plain : t[k]) }));`],
    ['6 (M1) Proxy in a Request', `${K}await fetch(new Request(u, new Proxy({ method: 'POST' }, { get: (t, k) => (k === K ? plain : t[k]) })));`],
    ['6 (M1) JSON.parse in a Request', `await fetch(new Request(u, { ...JSON.parse(${JM}) }));`],
    ['7 (M1) atob', "await fetch(u, new Proxy({ method: 'POST' }, { get: (t, k) => (k === atob('Ym9keQ==') ? plain : t[k]) }));"],
    ['8 (M1) __defineGetter__', `${K}init.__defineGetter__(K, () => plain);\nawait fetch(u, init);`],
    ['9 (M1) ({}).constructor', `${K}({}).constructor.defineProperty(init, K, { value: plain });`],
    ['9 (M1) constructor alias', `${K}const O = ({}).constructor;\nO.defineProperty(init, K, { value: plain });`],
    ['9 (M1) __proto__.constructor', `${K}({}).__proto__.constructor.defineProperty(init, K, { value: plain });`],
    ['10 (M2) split Reflect', `${K}globalThis['Ref' + 'lect'].set(init, K, plain);`],
    ['11 (M1) Function', "Function('a', 'b', 'a.bo' + 'dy = b')(init, plain);"],
    ['11 (M1) new Function', "new Function('a', 'b', 'a.bo' + 'dy = b')(init, plain);"],
    ['11 (M1) arrow constructor', "(() => 0).constructor('a', 'b', 'a.bo' + 'dy = b')(init, plain);"],
    ['12 (M1) eval', "eval('init.bo' + 'dy = plain');"],
    ['12 (M1) indirect eval', "(0, eval)('init.bo' + 'dy = plain');"],
    ['13 (M2) sendBeacon', "navigator['send' + 'Beacon'](u, plain);"],
    ['14 (M2) postMessage', "new BroadcastChannel('x')['post' + 'Message'](plain);"],
    ['14 (M2) postMessage by a const', "const pm = 'post' + 'Message';\nworker[pm](plain);"],
    ['15 (M2) WebSocket', "new globalThis['Web' + 'Socket'](u).send(plain);"],
    ['15 (M2) XMLHttpRequest', "const x = new globalThis['XMLHttp' + 'Request']();"],
    ['16 (M2) localStorage', "globalThis['local' + 'Storage'].setItem('k', plain);"],
    ['21 (M1) under a label', `out: { await fetch(u, JSON.parse(${JM})); }`],
  ];

  for (const [row, snippet] of PTW5_BYPASSES) {
    it(`PTW5 row ${row} is caught: ${snippet.replace(/\n/g, ' ')}`, () => {
      expect(sendsOut(snippet), snippet).not.toEqual([]);
      // By the tree rules on their own (PTW5-I3: no new regex).
      expect(treeOut(snippetProgram(snippet)), snippet).not.toEqual([]);
    });
  }

  it('PTW5-M1: JSON.parse, structuredClone, Proxy, Function, eval and atob by any reference, and the members __defineGetter__, __defineSetter__, __proto__ and constructor, are caught', () => {
    for (const snippet of [
      'const o = JSON.parse(s);',
      "const o = JSON['parse'](s);",
      'const J = JSON;\nconst o = J.parse(s);',
      'const { parse } = JSON;',
      'const o = globalThis.JSON.parse(s);',
      'const o = structuredClone(p);',
      'const p = new Proxy(o, h);',
      'class P extends Proxy {}',
      "const f = Function('return 1');",
      "const f = globalThis['Function'];",
      "const x = eval('1');",
      "const x = globalThis.eval('1');",
      "const x = window['eval']('1');",
      'const s = atob(b);',
      'const a = atob;',
      "o.__defineGetter__('x', f);",
      "o.__defineSetter__('x', f);",
      "o['__defineGetter__']('x', f);",
      'o.__proto__ = p;',
      'const p = o.__proto__;',
      "const p = o['__proto__'];",
      'const C = o.constructor;',
      'const C = o?.constructor;',
      "const C = o['constructor'];",
      'const C = (o as never).constructor;',
      'const { constructor: C } = o;',
      'const { __proto__: P } = o;',
      'class C { m() { return this.constructor; } }',
    ]) expect(treeOut(snippetProgram(snippet)), snippet).not.toEqual([]);
  });

  it('PTW5-M2: a computed member whose key is not a static literal is caught, read or written, unless its object is CHAT_PROOF_TITLE', () => {
    for (const snippet of [
      'const t = TITLES[proof.kind];',
      'const v = o[k];',
      'const v = a[i + 1];',
      'const v = o?.[k];',
      'const v = o[`${k}`];',
      'f(o[k]);',
      'const t = CHAT_PROOF_TITLE.x[proof.kind];',
      'const t = (CHAT_PROOF_TITLE as never)[proof.kind];',
    ]) expect(treeOut(snippetProgram(snippet)), snippet).not.toEqual([]);
    for (const snippet of ['const t = CHAT_PROOF_TITLE[proof.kind];', 'const v = o[0];', "const v = o['method'];", 'const v = o[`method`];']) {
      expect(treeOut(snippetProgram(snippet)), snippet).toEqual([]);
    }
  });

  it('PTW5-M1: a class constructor (a method key) and JSON.stringify do not trip', () => {
    for (const snippet of [
      "class ProofGone extends Error {\n  constructor() {\n    super('proof-gone');\n    this.name = 'ProofGone';\n  }\n}",
      'const s = JSON.stringify(o);',
    ]) expect(sendsOut(snippet), snippet).toEqual([]);
  });

  it("does not trip on reading a response body (ChatProof's own readCapped)", () => {
    for (const snippet of ['void res.body?.cancel().catch(() => undefined);', 'if (res.body === null) return new Uint8Array(0);', 'const reader = res.body.getReader();', 'if (res.body !== null) n++;', 'const [state, setState] = useState(0);', 'let [a, b] = pair;\n[a, b] = [b, a];', 'if (parts[0] === undefined) n++;', 'const parts: Uint8Array[] = [];', 'if (res?.body !== null) n++;', 'const reader = res.body!.getReader();', 'const title = CHAT_PROOF_TITLE[proof.kind];', 'if (res.body == null) n++;']) {
      expect(sendsOut(snippet), snippet).toEqual([]);
    }
    // PTW4: a static computed key that is not "body" (a read and a plain index write) is not the tree rules' business.
    // (PTW5-I2: these three are checked against the tree only; the text rule's indexed assignment still flags the two writes.)
    for (const snippet of ["const o = { ['method']: 'POST', [0]: 1 };", 'out[0] = 1;', "init['method'] = 'POST';"]) expect(treeOut(snippetProgram(snippet)), snippet).toEqual([]);
    expect(sendsOut(code('apps/web/src/screens/proof/ChatProof.tsx'), programOf('apps/web/src/screens/proof/ChatProof.tsx'))).toEqual([]);
  });
});

/**
 * Plan 5 Task 16 (the seller's smart proof card): the seller's device reads the words on the proof
 * with its own OCR. The OCR reads only the receive check's redrawn copy, on the receive path
 * (receive.ts `browserReadWords` -> proof/ocr.ts, the self-hosted worker), and only words come back to
 * the page (`onWords`). These pin that path so a later change cannot turn it into a way out.
 */
describe('Task 16: the OCR of a received proof stays on the receive path and gives back words only', () => {
  const RECEIVE = 'apps/web/src/proof/receive.ts';
  const OCR = 'apps/web/src/proof/ocr.ts';
  const OUT = /\bfetch\s*\(|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b|\bXMLHttpRequest\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bcaches\b|createObjectURL|\bopen\s*\(/;

  it('receive.ts loads only the OCR module, and sends nothing out of the page', () => {
    const c = code(RECEIVE);
    const m = moduleOf(RECEIVE);
    expect(m.dynamicImports.map((d) => c.slice(d.moduleRequest.start, d.moduleRequest.end))).toEqual(["'./ocr.js'"]);
    expect(Object.keys(importsOf(m))).toEqual(['@x2f/proof']);
    expect(c).not.toMatch(OUT);
    expect(c).not.toMatch(/\bpostMessage\b/);
  });

  it("showableProof's onWords takes OCR words or null, nothing else; the reader is named only on the receive path", () => {
    expect(code(RECEIVE)).toMatch(/onWords\?: \(words: OcrWord\[\] \| null\) => void/);
    expect(code(PROOF_THUMB)).toMatch(/onWords\?: \(words: OcrWord\[\] \| null\) => void/);
    for (const f of files) {
      if (f === RECEIVE) continue;
      expect(code(f), `${f}: readWords (the OCR of a received proof) belongs to receive.ts`).not.toMatch(/\breadWords\b|\bbrowserReadWords\b/);
    }
  });

  it('the OCR module talks only to its own worker: no request, storage or other channel of its own, and loads only tesseract.js', () => {
    const c = code(OCR);
    const m = moduleOf(OCR);
    expect(m.dynamicImports.map((d) => c.slice(d.moduleRequest.start, d.moduleRequest.end))).toEqual(["'tesseract.js'"]);
    expect(Object.keys(importsOf(m))).toEqual(['@x2f/proof']);
    expect(c).not.toMatch(OUT);
    expect(c).not.toMatch(/\bpostMessage\b/);
  });
});
