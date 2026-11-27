// `tsx tools/copy-inventory.ts` (owner p5-1, Job 7): scans `apps/web/src`, `apps/staff-web/src`,
// and `packages/<pkg>/src` for every user-facing string marked `COPY-UNSIGNED`, groups them by
// screen/route in user-journey order, and writes `docs/copy-unsigned-by-screen.md` so the owner
// can review and sign off wording screen by screen.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_OUTPUT = fileURLToPath(new URL('../docs/copy-unsigned-by-screen.md', import.meta.url));

export interface ScreenGroup {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly route: string;
}

export interface UnsignedCopyItem {
  readonly file: string;
  readonly line: number;
  readonly commentLine: number;
  readonly text: string;
  readonly note: string;
  readonly screen: ScreenGroup;
}

const SCREEN_GROUPS: readonly { test: RegExp; group: ScreenGroup }[] = [
  {
    test: /^apps\/web\/src\/screens\/auth\/Landing\.tsx$/,
    group: { id: 'landing', order: 1, title: 'Front Door — Landing', route: '`/`' },
  },
  {
    test: /^apps\/web\/src\/screens\/auth\/(?:Login|ApproveOnDevice|keyErrors|refusals|loginRules)\./,
    group: { id: 'login', order: 2, title: 'Log In & Device Approval', route: '`/login`' },
  },
  {
    test: /^apps\/web\/src\/screens\/auth\/BackupLogin\.tsx$/,
    group: { id: 'login-backup', order: 3, title: 'Backup Login (Recovery Code)', route: '`/login/backup`' },
  },
  {
    test: /^apps\/web\/src\/screens\/auth\/(?:SessionLength|SessionPrompt|sessionCopy)\./,
    group: { id: 'session-length', order: 4, title: 'Session Length & Stay Logged In Prompt', route: '`/session-length`, `/settings/idle-reminder`' },
  },
  {
    test: /^apps\/web\/src\/screens\/setup\/(?:Terms|TermsParagraphs|termsText|SignaturePad)\./,
    group: { id: 'setup-terms', order: 5, title: 'Create Account — Step 1: Terms of Service', route: '`/setup`, `/terms`' },
  },
  {
    test: /^apps\/web\/src\/screens\/setup\/(?:Username|DisplayName|names)\./,
    group: { id: 'setup-names', order: 6, title: 'Create Account — Step 2: Username & Trade Tag', route: '`/setup/name`, `/setup/trade-tag`' },
  },
  {
    test: /^apps\/web\/src\/screens\/setup\/(?:Login|MoreMethods|SecurityKeyArt|Password)\./,
    group: {
      id: 'setup-login',
      order: 7,
      title: 'Create Account — Step 3: Login & Security Methods',
      route: '`/setup/login`, `/setup/security-key`, `/setup/passkey`, `/setup/password`',
    },
  },
  {
    test: /^apps\/web\/src\/screens\/setup\/(?:PgpKey|PgpChallenge)\./,
    group: { id: 'setup-pgp', order: 8, title: 'Create Account — Step 3b: PGP Key & Challenge', route: '`/setup/pgp-key`, `/setup/pgp-code`' },
  },
  {
    test: /^apps\/web\/src\/screens\/setup\/Backup\./,
    group: { id: 'setup-backup', order: 9, title: 'Create Account — Step 4: Save Recovery Code', route: '`/setup/backup`' },
  },
  {
    test: /^apps\/web\/src\/screens\/setup\/(?:Wallet|Welcome|kit|SetupFlow)\./,
    group: { id: 'setup-welcome', order: 10, title: 'Create Account — Step 5 & 6: Wallet & Setup Welcome', route: '`/setup/wallet`, `/setup/welcome`' },
  },
  {
    test: /^apps\/web\/src\/screens\/welcome\/WelcomeScreen\.tsx$/,
    group: { id: 'welcome', order: 11, title: 'First Screen — Welcome to X2F', route: '`/welcome` (first visit to `/sell`)' },
  },
  {
    test: /^apps\/web\/src\/tour\//,
    group: { id: 'tour', order: 12, title: 'Guided Site Tour (First Trade Tour)', route: '`/welcome` → Tour overlay (`FirstTradeStage`)' },
  },
  {
    test: /^apps\/web\/src\/screens\/(?:welcome\/Help|HelpTopic\.|help\/)/,
    group: { id: 'help', order: 13, title: 'Help, FAQ & Getting Started', route: '`/help`, `/help/:topic`' },
  },
  {
    test: /^apps\/web\/src\/screens\/browse\//,
    group: { id: 'browse', order: 14, title: 'Browse Offers — Buy & Sell', route: '`/buy`, `/sell`' },
  },
  {
    test: /^(?:apps\/web\/src\/screens\/quote\/|apps\/web\/src\/screens\/giftcard\/|packages\/trade\/src\/giftCards\.ts$)/,
    group: { id: 'quote', order: 15, title: 'Offer Quote & Gift Card Rules', route: '`/buy/offer/:id`, `/sell/offer/:id`' },
  },
  {
    test: /^apps\/web\/src\/screens\/(?:PostOffer|post\/)/,
    group: { id: 'post-offer', order: 16, title: 'Post & Edit an Offer', route: '`/post`, `/my-offers/:id/edit`' },
  },
  {
    test: /^apps\/web\/src\/screens\/(?:MyOffers|myoffers\/)/,
    group: { id: 'my-offers', order: 17, title: 'My Offers', route: '`/my-offers`' },
  },
  {
    test: /^apps\/web\/src\/screens\/(?:Trades|trades\/)/,
    group: { id: 'trades', order: 18, title: 'Trades List (Open & Past Trades)', route: '`/trades`' },
  },
  {
    test: /^(?:apps\/web\/src\/screens\/trade\/|apps\/web\/src\/chat\/|apps\/web\/src\/screens\/proof\/|apps\/web\/src\/screens\/review\/|apps\/web\/src\/screens\/profile\/|packages\/trade\/src\/payFields\.ts$|packages\/proof\/|packages\/reputation\/)/,
    group: { id: 'trade-room', order: 19, title: 'Trade Room, Chat, Payment Details, Proof & Ratings', route: '`/trade/:id`, `/profile/:name`' },
  },
  {
    test: /^apps\/web\/src\/screens\/dispute\//,
    group: { id: 'dispute', order: 20, title: 'Dispute Room, Filing & Rulings', route: '`/trade/:id/dispute`, `/disputes/:id`' },
  },
  {
    test: /^apps\/web\/src\/screens\/settings\/(?:Security|Methods|RecoveryCodes|Totp|Alerts|Devices|devicesCopy|holdCopy|HoldChanges)\./,
    group: {
      id: 'settings-security',
      order: 21,
      title: 'Settings — Security, Recovery Code, Holds, Devices & Alerts',
      route: '`/settings/security`, `/settings/changes`, `/settings/devices`, `/settings/alerts`',
    },
  },
  {
    test: /^(?:apps\/web\/src\/screens\/settings\/(?:accountTypeCopy|AccountType|teamCopy|Team)|packages\/accounts\/src\/confirmAction\.ts$)/,
    group: {
      id: 'settings-account-team',
      order: 22,
      title: 'Settings — Account Type, Team Members & Confirm Sheet Actions',
      route: '`/settings/account-type`, `/settings/team`, `/team/join`',
    },
  },
  {
    test: /^apps\/web\/src\/screens\/settings\/(?:jabberCopy|Jabber|JabberEvents)\./,
    group: { id: 'settings-jabber', order: 23, title: 'Settings — Jabber & OMEMO Notifications', route: '`/settings/jabber`, `/settings/jabber/events`' },
  },
  {
    test: /^apps\/web\/src\/screens\/settings\/(?:Blocked|blockCopy)\./,
    group: { id: 'settings-blocked', order: 24, title: 'Settings — Blocked Traders', route: '`/settings/blocked`' },
  },
  {
    test: /^apps\/web\/src\/screens\/(?:Feedback|News|NewsPost|Maintenance|account\/)/,
    group: { id: 'feedback-news-status', order: 25, title: 'Feedback, Site News, Maintenance & Account Status', route: '`/feedback`, `/news`, `/maintenance`' },
  },
  {
    test: /^apps\/web\/src\/ui\/cantDoCodes\.ts$/,
    group: { id: 'cant-do-that', order: 26, title: 'Shared Refusal Popups (`CantDoThat` Messages Across Screens)', route: 'All trader screens (`CantDoThat` dialog)' },
  },
  {
    test: /^apps\/web\/src\/(?:ui|alerts|session)\//,
    group: { id: 'shared-shell', order: 27, title: 'Shared Trader Shell, Headers, Navigation & Banners', route: 'App shell (all trader screens)' },
  },
  {
    test: /^(?:apps\/staff-web\/|packages\/staff\/|packages\/accounts\/src\/pgp\.ts$)/,
    group: { id: 'staff-web', order: 28, title: 'Staff Web App (Moderator & Owner Screens)', route: 'Staff app (`/login`, `/setup`, `/disputes`, `/grants`, `/prices`)' },
  },
];

export function screenForFile(relFile: string): ScreenGroup {
  const norm = relFile.replace(/\\/g, '/');
  for (const entry of SCREEN_GROUPS) {
    if (entry.test.test(norm)) return entry.group;
  }
  return { id: 'other', order: 99, title: 'Other Shared Modules', route: 'Shared' };
}

const JS_TS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const COPY_ATTRS = new Set(['title', 'label', 'aria-label', 'placeholder', 'body', 'alt', 'caption', 'description', 'hint', 'summary', 'heading', 'lead']);
const NON_COPY_KEYS = new Set([
  'id',
  'key',
  'to',
  'path',
  'href',
  'code',
  'reasonCode',
  'kind',
  'type',
  'icon',
  'placement',
  'target',
  'tap',
  'then',
  'flow',
  'endPath',
  'strength',
  'tone',
  'variant',
  'role',
  'screen',
  'part',
  'method',
]);

interface RawPiece {
  text: string;
  start: number;
  end: number;
  line: number;
}

interface AstSpan {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}

interface CommentSpan {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  text: string;
}

function lineAt(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function buildLineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function looksLikeUserCopy(text: string, propKey: string | null): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return false;
  if (propKey !== null && NON_COPY_KEYS.has(propKey)) return false;
  // Skip URL/route paths (including template route strings), CSS selectors, or bare lowercase slugs.
  if (/^(?:\/\S*|[a-z]+:\/\/\S*|\[data-|[.#][a-z0-9_-]+)$/i.test(trimmed)) return false;
  if (/^[a-z0-9_.:/-]+$/.test(trimmed)) return false;
  // Skip single-token camelCase/PascalCase code identifiers (e.g. SecurityError, NotAllowedError).
  if (/^[A-Za-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(trimmed)) return false;
  // Skip WebAuthn error codes / uppercase constants (e.g. ERROR_INVALID_RP_ID, ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED).
  if (/^[A-Z0-9_]{3,}$/.test(trimmed)) return false;
  // Skip example numbers / crypto currency pairs without prose (e.g. "≈ 0.148588 – 2.971768 XMR").
  if (/^[≈~]?\s*[\d\s.,–-]+\s*(?:XMR|USD|CAD|EUR|GBP|AUD|BTC)?$/i.test(trimmed) && !/[a-z]{4,}/i.test(trimmed)) return false;
  // Skip developer notes and links that are not trader copy (review N4): URLs, "research ..." notes, locale tags.
  if (/https?:/i.test(trimmed) || /^research /i.test(trimmed)) return false;
  if (/^[a-z]{2,3}-[A-Z]{2}$/.test(trimmed)) return false;
  // Require at least one letter.
  if (!/[A-Za-z]/.test(trimmed)) return false;
  return true;
}

/**
 * A template literal's text with each `${expr}` kept as written, except that a `x.toLocaleString(...)`
 * call shows as `${x}`: its locale and options are formatting, not copy (review N4).
 */
function templateText(n: Record<string, unknown>, src: string): string {
  const start = typeof n.start === 'number' ? n.start : 0;
  const end = typeof n.end === 'number' ? n.end : start;
  const exprs = Array.isArray(n.expressions) ? (n.expressions as Record<string, unknown>[]) : [];
  let out = '';
  let at = start + 1;
  for (const e of exprs) {
    const eStart = typeof e.start === 'number' ? e.start : at;
    const eEnd = typeof e.end === 'number' ? e.end : eStart;
    out += src.slice(at, eStart);
    const callee = e.type === 'CallExpression' ? (e.callee as Record<string, unknown> | undefined) : undefined;
    const prop = callee?.type === 'MemberExpression' ? (callee.property as Record<string, unknown> | undefined) : undefined;
    const obj = callee?.object as Record<string, unknown> | undefined;
    if (typeof prop?.name === 'string' && /^toLocale/.test(prop.name) && typeof obj?.start === 'number' && typeof obj?.end === 'number') {
      out += src.slice(obj.start, obj.end);
    } else {
      out += src.slice(eStart, eEnd);
    }
    at = eEnd;
  }
  return out + src.slice(at, end - 1);
}

/** True when an expression holds JSX anywhere (e.g. `cond ? <>A</> : <>B</>` or `ok && <b>x</b>`). */
function containsJsx(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(containsJsx);
  if (node === null || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  if (n.type === 'JSXElement' || n.type === 'JSXFragment') return true;
  for (const [k, v] of Object.entries(n)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
    if (containsJsx(v)) return true;
  }
  return false;
}

const BLOCK_TAGS = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'ul',
  'ol',
  'table',
  'tbody',
  'thead',
  'tr',
  'form',
  'main',
]);

function isInlineChild(c: Record<string, unknown>): boolean {
  const type = typeof c.type === 'string' ? c.type : '';
  if (type === 'JSXText') return true;
  // A `{cond ? <>A</> : <>B</>}` child is not one sentence: fall back to per-child collection so each
  // branch's text is listed on its own (review N2).
  if (type === 'JSXExpressionContainer') return !containsJsx(c.expression);
  if (type === 'JSXElement') {
    const opening = c.openingElement as Record<string, unknown> | undefined;
    const nameObj = opening?.name as Record<string, unknown> | undefined;
    const tag = typeof nameObj?.name === 'string' ? nameObj.name : '';
    if (tag && BLOCK_TAGS.has(tag.toLowerCase())) return false;
    return true;
  }
  if (type === 'JSXFragment') return true;
  return false;
}

function getInlineJsxText(node: Record<string, unknown>, source: string): string {
  const type = typeof node.type === 'string' ? node.type : '';
  if (type === 'JSXText') return typeof node.value === 'string' ? node.value : '';
  if (type === 'JSXExpressionContainer') {
    const expr = node.expression as Record<string, unknown> | undefined;
    // `{/* comment */}` is a JSXEmptyExpression: it holds no copy.
    if (expr?.type === 'JSXEmptyExpression') return '';
    if (expr?.type === 'Literal') return String(expr.value ?? '');
    if (typeof expr?.start === 'number' && typeof expr?.end === 'number') {
      const exprCode = source.slice(expr.start, expr.end).trim();
      return `{${exprCode}}`;
    }
    return '{...}';
  }
  if (type === 'JSXElement' || type === 'JSXFragment') {
    const opening = node.openingElement as Record<string, unknown> | undefined;
    const nameObj = opening?.name as Record<string, unknown> | undefined;
    const tag = typeof nameObj?.name === 'string' ? nameObj.name : '';
    if (tag === 'Name') {
      const attrs = Array.isArray(opening?.attributes) ? (opening!.attributes as Record<string, unknown>[]) : [];
      const nameAttr = attrs.find((a) => {
        const n = a.name as Record<string, unknown> | undefined;
        return n?.name === 'name';
      });
      const val = nameAttr?.value as Record<string, unknown> | undefined;
      const expr = val?.expression as Record<string, unknown> | undefined;
      if (typeof expr?.name === 'string') return `{${expr.name}}`;
      return '{name}';
    }
    if (tag === 'Icon') return '';
    if (Array.isArray(node.children)) {
      return (node.children as Record<string, unknown>[]).map((c) => getInlineJsxText(c, source)).join('');
    }
  }
  return '';
}

function collectAst(
  node: unknown,
  src: string,
  lineStarts: number[],
  pieces: RawPiece[],
  ranges: [number, number][],
  spans: AstSpan[],
  context: { inType?: boolean; inImportExport?: boolean; jsxAttrName?: string | null; propKey?: string | null } = {},
): void {
  if (Array.isArray(node)) {
    for (const child of node) collectAst(child, src, lineStarts, pieces, ranges, spans, context);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  const type = typeof n.type === 'string' ? n.type : '';
  const start = typeof n.start === 'number' ? n.start : 0;
  const end = typeof n.end === 'number' ? n.end : start;

  if (type.startsWith('TS') && type !== 'TSAsExpression' && type !== 'TSSatisfiesExpression' && type !== 'TSNonNullExpression') {
    return;
  }
  if (type === 'ImportDeclaration' || type === 'ExportAllDeclaration') {
    return;
  }

  if (end > start && type !== 'Program') {
    spans.push({
      start,
      end,
      startLine: lineAt(lineStarts, start),
      endLine: lineAt(lineStarts, Math.max(start, end - 1)),
    });
  }

  if (type === 'JSXElement') {
    const opening = n.openingElement as Record<string, unknown> | undefined;
    if (opening) {
      collectAst(opening, src, lineStarts, pieces, ranges, spans, context);
    }
    const children = Array.isArray(n.children) ? (n.children as Record<string, unknown>[]) : [];
    const hasText = children.some((c) => c.type === 'JSXText' && typeof c.value === 'string' && c.value.trim().length > 0);
    const allInline = children.length > 0 && children.every(isInlineChild);
    if (hasText && allInline) {
      const rawText = getInlineJsxText(n, src).replace(/\s+/g, ' ').replace(/\s+([',.?!\-:])/g, '$1').trim();
      if (looksLikeUserCopy(rawText, null)) {
        for (const child of children) {
          const cStart = typeof child.start === 'number' ? child.start : start;
          const cEnd = typeof child.end === 'number' ? child.end : end;
          ranges.push([cStart, cEnd]);
        }
        pieces.push({ text: rawText, start, end, line: lineAt(lineStarts, start) });
        return;
      }
    }
    for (const child of children) {
      collectAst(child, src, lineStarts, pieces, ranges, spans, context);
    }
    return;
  }

  if (type === 'JSXFragment') {
    const children = Array.isArray(n.children) ? (n.children as Record<string, unknown>[]) : [];
    const hasText = children.some((c) => c.type === 'JSXText' && typeof c.value === 'string' && c.value.trim().length > 0);
    const allInline = children.length > 0 && children.every(isInlineChild);
    if (hasText && allInline) {
      const rawText = getInlineJsxText(n, src).replace(/\s+/g, ' ').replace(/\s+([',.?!\-:])/g, '$1').trim();
      if (looksLikeUserCopy(rawText, null)) {
        for (const child of children) {
          const cStart = typeof child.start === 'number' ? child.start : start;
          const cEnd = typeof child.end === 'number' ? child.end : end;
          ranges.push([cStart, cEnd]);
        }
        pieces.push({ text: rawText, start, end, line: lineAt(lineStarts, start) });
        return;
      }
    }
    for (const child of children) {
      collectAst(child, src, lineStarts, pieces, ranges, spans, context);
    }
    return;
  }

  if (type === 'Literal') {
    if (typeof n.value === 'string' || n.regex !== undefined) ranges.push([start, end]);
    if (typeof n.value === 'string' && n.regex === undefined) {
      if (context.jsxAttrName !== undefined && context.jsxAttrName !== null && !COPY_ATTRS.has(context.jsxAttrName)) {
        return;
      }
      const cleaned = n.value.replace(/\s+/g, ' ').trim();
      if (looksLikeUserCopy(cleaned, context.propKey ?? null)) {
        pieces.push({ text: cleaned, start, end, line: lineAt(lineStarts, start) });
      }
    }
    return;
  }

  if (type === 'JSXText') {
    ranges.push([start, end]);
    if (typeof n.value === 'string') {
      const cleaned = n.value.replace(/\s+/g, ' ').trim();
      if (looksLikeUserCopy(cleaned, null)) {
        pieces.push({ text: cleaned, start, end, line: lineAt(lineStarts, start) });
      }
    }
    return;
  }

  if (type === 'TemplateLiteral') {
    const quasis = Array.isArray(n.quasis) ? (n.quasis as Record<string, unknown>[]) : [];
    for (const q of quasis) {
      if (typeof q.start === 'number' && typeof q.end === 'number') ranges.push([q.start, q.end]);
    }
    if (context.jsxAttrName !== undefined && context.jsxAttrName !== null && !COPY_ATTRS.has(context.jsxAttrName)) {
      return;
    }
    const rawTemplate = templateText(n, src).replace(/\s+/g, ' ').trim();
    if (looksLikeUserCopy(rawTemplate, context.propKey ?? null)) {
      pieces.push({ text: rawTemplate, start, end, line: lineAt(lineStarts, start) });
    }
    return;
  }

  if (type === 'CallExpression' || type === 'NewExpression') {
    const callee = n.callee as Record<string, unknown> | undefined;
    const prop = callee?.type === 'MemberExpression' ? (callee.property as Record<string, unknown> | undefined) : undefined;
    if (typeof prop?.name === 'string' && /^toLocale/.test(prop.name)) {
      collectAst(callee, src, lineStarts, pieces, ranges, spans, context);
      // Keep string ranges for comment masking, but do not list the arguments ('en-US', options).
      collectAst(n.arguments, src, lineStarts, [], ranges, spans, context);
      return;
    }
  }

  if (type === 'JSXAttribute') {
    const attrNameObj = n.name as { name?: unknown } | undefined;
    const attrName = typeof attrNameObj?.name === 'string' ? attrNameObj.name : null;
    collectAst(n.value, src, lineStarts, pieces, ranges, spans, { ...context, jsxAttrName: attrName });
    return;
  }

  if (type === 'Property' || type === 'ObjectProperty') {
    const keyObj = n.key as { name?: unknown; value?: unknown } | undefined;
    const propKey = typeof keyObj?.name === 'string' ? keyObj.name : typeof keyObj?.value === 'string' ? keyObj.value : null;
    collectAst(n.value, src, lineStarts, pieces, ranges, spans, { ...context, propKey });
    return;
  }

  for (const [k, v] of Object.entries(n)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
    collectAst(v, src, lineStarts, pieces, ranges, spans, context);
  }
}

function extractComments(src: string, lineStarts: number[], ranges: [number, number][]): CommentSpan[] {
  const masked = new Uint8Array(src.length + 1);
  for (const [a, b] of ranges) masked.fill(1, a, b);
  const out: CommentSpan[] = [];
  for (let i = src.indexOf('/'); i !== -1 && i < src.length - 1; i = src.indexOf('/', i + 1)) {
    if ((src[i + 1] !== '/' && src[i + 1] !== '*') || masked[i] === 1) continue;
    const close = src[i + 1] === '/' ? src.indexOf('\n', i) : src.indexOf('*/', i + 2);
    const end = close === -1 ? src.length : src[i + 1] === '/' ? close : close + 2;
    out.push({
      start: i,
      end,
      startLine: lineAt(lineStarts, i),
      endLine: lineAt(lineStarts, Math.max(i, end - 1)),
      text: src.slice(i, end),
    });
    i = end - 1;
  }
  return out;
}

function cleanCommentNote(raw: string): string {
  return raw
    .replace(/^\/\*+|\*+\/$/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\/\/|\*)\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scans one source file and returns every `COPY-UNSIGNED` user-facing text piece with its exact line.
 */
export function scanUnsignedSource(src: string, relFile: string): UnsignedCopyItem[] {
  const ext = extname(relFile);
  if (!JS_TS.has(ext)) return [];
  const lang = ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : ext === '.js' || ext === '.mjs' || ext === '.cjs' ? 'js' : 'ts';
  let program: unknown;
  try {
    program = parseAst(src, { lang }, relFile);
  } catch {
    return [];
  }

  const lineStarts = buildLineStarts(src);
  const lines = src.split('\n');
  const pieces: RawPiece[] = [];
  const ranges: [number, number][] = [];
  const spans: AstSpan[] = [];
  collectAst(program, src, lineStarts, pieces, ranges, spans);

  const allComments = extractComments(src, lineStarts, ranges);
  const unsignedComments = allComments.filter((c) => c.text.includes('COPY-UNSIGNED'));
  if (unsignedComments.length === 0) return [];

  const commentLines = new Set<number>();
  for (const c of allComments) {
    for (let l = c.startLine; l <= c.endLine; l++) commentLines.add(l);
  }

  const screen = screenForFile(relFile);
  // Map each COPY-UNSIGNED comment to the line range [startLine, endLine] of the AST construct it annotates.
  const scopes: { comment: CommentSpan; note: string; targetStartLine: number; targetEndLine: number }[] = [];

  for (const c of unsignedComments) {
    const note = cleanCommentNote(c.text);
    // Check if there is code on the same line before the comment (trailing comment, e.g. `label: '...', // COPY-UNSIGNED`).
    const sameLinePieces = pieces.filter((p) => p.line === c.startLine || p.line === c.endLine);
    if (sameLinePieces.length > 0) {
      const l = sameLinePieces[0]!.line;
      scopes.push({ comment: c, note, targetStartLine: l, targetEndLine: l });
      continue;
    }

    // Otherwise, advance past blank lines, JSX `{/* ... */}` braces, and consecutive comments (such as `// not-a-refusal:`).
    let targetLine = c.endLine + 1;
    while (targetLine <= lines.length) {
      const trimmed = lines[targetLine - 1]!.trim();
      if (trimmed === '' || trimmed === '{' || trimmed === '}' || commentLines.has(targetLine)) {
        targetLine++;
      } else {
        break;
      }
    }

    if (targetLine > lines.length) {
      scopes.push({ comment: c, note, targetStartLine: c.startLine, targetEndLine: c.endLine });
      continue;
    }

    // If this comment is at the top of the file (before imports) and says "all of" / "every sentence" or is the only COPY-UNSIGNED in the file:
    const targetTrimmed = lines[targetLine - 1]!.trim();
    if (/^import\s/.test(targetTrimmed) || (c.startLine <= 15 && unsignedComments.length === 1 && !pieces.some((p) => p.line === targetLine))) {
      scopes.push({ comment: c, note, targetStartLine: targetLine, targetEndLine: lines.length });
      continue;
    }

    // Find the largest AST span starting on `targetLine` (e.g., VariableDeclaration, Property, JSXElement, ReturnStatement, ExpressionStatement).
    const startingSpans = spans.filter((s) => s.startLine === targetLine);
    if (startingSpans.length > 0) {
      const maxEnd = Math.max(...startingSpans.map((s) => s.endLine));
      scopes.push({ comment: c, note, targetStartLine: targetLine, targetEndLine: maxEnd });
    } else {
      scopes.push({ comment: c, note, targetStartLine: targetLine, targetEndLine: targetLine });
    }
  }

  // Assign each user-facing text piece that falls inside one or more scopes to the most specific (smallest-range) scope.
  const out: UnsignedCopyItem[] = [];
  const coveredScopes = new Set<number>();
  const seenPiece = new Set<string>();

  for (const p of pieces) {
    let bestIdx = -1;
    let bestLen = Infinity;
    for (let i = 0; i < scopes.length; i++) {
      const s = scopes[i]!;
      if (p.line >= s.targetStartLine && p.line <= s.targetEndLine) {
        const len = s.targetEndLine - s.targetStartLine;
        if (len <= bestLen) {
          bestLen = len;
          bestIdx = i;
        }
      }
    }
    if (bestIdx !== -1) {
      coveredScopes.add(bestIdx);
      const s = scopes[bestIdx]!;
      const key = `${relFile}:${p.line}:${p.text}`;
      if (!seenPiece.has(key)) {
        seenPiece.add(key);
        out.push({
          file: relFile,
          line: p.line,
          commentLine: s.comment.startLine,
          text: p.text,
          note: s.note,
          screen,
        });
      }
    }
  }

  // If a COPY-UNSIGNED comment annotated a helper or type with no literal piece captured inside its span,
  // check if any piece sits within 3 lines after `targetStartLine`.
  for (let i = 0; i < scopes.length; i++) {
    if (coveredScopes.has(i)) continue;
    const s = scopes[i]!;
    const nearby = pieces.filter((p) => p.line >= s.targetStartLine && p.line <= s.targetStartLine + 3);
    for (const p of nearby) {
      const key = `${relFile}:${p.line}:${p.text}`;
      if (!seenPiece.has(key)) {
        seenPiece.add(key);
        out.push({
          file: relFile,
          line: p.line,
          commentLine: s.comment.startLine,
          text: p.text,
          note: s.note,
          screen,
        });
      }
    }
  }

  return out.sort((a, b) => a.line - b.line);
}

const DEFAULT_DIRS = [
  'apps/web/src',
  'apps/staff-web/src',
  'packages/accounts/src',
  'packages/proof/src',
  'packages/reputation/src',
  'packages/staff/src',
  'packages/trade/src',
];

export function collectUnsignedCopy(repoRoot = REPO_ROOT): UnsignedCopyItem[] {
  const items: UnsignedCopyItem[] = [];
  for (const relDir of DEFAULT_DIRS) {
    const absDir = join(repoRoot, relDir);
    let entries;
    try {
      entries = readdirSync(absDir, { recursive: true, withFileTypes: true });
    } catch {
      continue;
    }
    const files = entries
      .filter((e) => e.isFile() && JS_TS.has(extname(e.name)))
      .map((e) => join(e.parentPath, e.name))
      .sort();
    for (const absPath of files) {
      const relFile = relative(repoRoot, absPath).replace(/\\/g, '/');
      const src = readFileSync(absPath, 'utf8');
      items.push(...scanUnsignedSource(src, relFile));
    }
  }
  return items.sort((a, b) => a.screen.order - b.screen.order || a.file.localeCompare(b.file) || a.line - b.line);
}

/** A marker note that signs only part of what it covers (e.g. "all of it except the slogan"). */
export const PARTLY_SIGNED = /\bexcept\b/i;
export const PARTLY_MARK = '(partly signed; check)';

function escapeMdLine(s: string): string {
  return s.replace(/</g, '&lt;').replace(/\r?\n/g, ' ');
}

function escapeMdTable(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderUnsignedMarkdown(items: readonly UnsignedCopyItem[]): string {
  const byScreen = new Map<string, { group: ScreenGroup; items: UnsignedCopyItem[] }>();
  for (const item of items) {
    let bucket = byScreen.get(item.screen.id);
    if (!bucket) {
      bucket = { group: item.screen, items: [] };
      byScreen.set(item.screen.id, bucket);
    }
    bucket.items.push(item);
  }

  const groups = [...byScreen.values()].sort((a, b) => a.group.order - b.group.order);
  const fileCount = new Set(items.map((i) => i.file)).size;

  const lines: string[] = [
    '# Unsigned Copy Inventory by Screen (`COPY-UNSIGNED`)',
    '',
    'Generated by `tsx tools/copy-inventory.ts` (owner p5-1, Job 7).',
    `Total user-facing strings marked \`COPY-UNSIGNED\`: **${items.length}** across **${fileCount}** source files in **${groups.length}** screen groups.`,
    '',
    '## Screen Summary',
    '',
    '| # | Screen / Area | Route(s) | Unsigned Strings |',
    '|---:|---|---|---:|',
  ];

  groups.forEach(({ group, items: groupItems }, idx) => {
    lines.push(`| ${idx + 1} | [${group.title}](#${group.id}) | ${group.route} | ${groupItems.length} |`);
  });

  lines.push('');

  groups.forEach(({ group, items: groupItems }, idx) => {
    lines.push(`---`, '', `<a id="${group.id}"></a>`, `## ${idx + 1}. ${group.title}`, '', `- **Route(s):** ${group.route}`, '');

    // Group by file within the screen section for easy reading
    const byFile = new Map<string, UnsignedCopyItem[]>();
    for (const item of groupItems) {
      let list = byFile.get(item.file);
      if (!list) {
        list = [];
        byFile.set(item.file, list);
      }
      list.push(item);
    }

    for (const [file, fileItems] of byFile) {
      lines.push(`### \`${file}\` (${fileItems.length})`, '');
      // Print each marker's note once, above the rows it covers (review N1: a note per row made the doc 4x bigger).
      const byMarker = new Map<number, UnsignedCopyItem[]>();
      for (const item of fileItems) {
        let list = byMarker.get(item.commentLine);
        if (!list) {
          list = [];
          byMarker.set(item.commentLine, list);
        }
        list.push(item);
      }
      for (const [commentLine, markerItems] of byMarker) {
        const note = markerItems[0]!.note;
        // A note that signs part of its scope ("all of it except ...") cannot be split by a tool: flag every row.
        const partly = PARTLY_SIGNED.test(note);
        lines.push(`**Marker (line ${commentLine}):** ${note ? escapeMdLine(note) : '—'}${partly ? ` ${PARTLY_MARK}` : ''}`, '');
        lines.push('| `file:line` | User-facing text |', '|---|---|');
        for (const item of markerItems) {
          lines.push(`| \`${item.file}:${item.line}\` | \`${escapeMdTable(item.text)}\`${partly ? ` ${PARTLY_MARK}` : ''} |`);
        }
        lines.push('');
      }
    }
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const isCheck = process.argv.includes('--check');
  const customPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const outPath = customPath ? resolve(customPath) : DEFAULT_OUTPUT;
  const items = collectUnsignedCopy(REPO_ROOT);
  const md = renderUnsignedMarkdown(items);
  if (isCheck) {
    const onDisk = readFileSync(outPath, 'utf8');
    if (onDisk !== md) {
      console.error(`copy-inventory: ${relative(REPO_ROOT, outPath)} is out of date. Run 'npm run copy-inventory' to regenerate.`);
      process.exit(1);
    }
    console.log(`copy-inventory: ${relative(REPO_ROOT, outPath)} is up to date (${items.length} strings).`);
    process.exit(0);
  }
  writeFileSync(outPath, md, 'utf8');
  console.log(`copy-inventory: wrote ${items.length} COPY-UNSIGNED strings to ${relative(REPO_ROOT, outPath)}`);
}
