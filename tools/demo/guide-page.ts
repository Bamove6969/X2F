/**
 * DEMO ONLY: GET /__demo/guide on the gateway, a screen-by-screen checklist of the app for trying
 * the demo from a phone: each feature, a link to its screen and which seeded account to use. Built
 * like /__demo/codes (codes-page.ts): one static page, no script, its only style allowed by hash.
 * It reads what the seed made (.demo/state/seed.json: login names, offers, trade codes; no secrets)
 * and never reaches the API.
 *
 * On a demo round's branch the page opens with "New in this demo" (guide-round.ts), one screen at a
 * time, each with the owner's demo note numbers it answers (main has none). And /__demo/guide/legal shows the Terms legal
 * review (docs/terms-legal-review-2026-11-23.md) as a page, rendered here. Both pages carry the
 * app's Comment button (notes.js, page-csp.ts); each item is a section with its own data-screen
 * (guide-new-A, guide-step-5, legal-proposal-7 ...), which a comment records, so a comment says
 * which guide item or legal proposal it is about.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEMO_PASSWORD, ROOT, STATE_DIR } from './config.js';
import { demoPageCsp, NOTES_TAG } from './page-csp.js';
import { forwardedHttps } from './self-origin.js';
import { ROUND, roundSteps, type GuideStep, type NewStep } from './guide-round.js';
import { TERMS_TEXT_VERSION } from '../../apps/web/src/screens/setup/termsText.js';

export type { NewStep };

/** What the seed made (seed.ts writes it). */
export const SEED_SUMMARY_FILE = join(STATE_DIR, 'seed.json');

export interface SeedSummary {
  owner: Array<{ login: string; shown: string; vendor: boolean }>;
  cast: Array<{ login: string; shown: string; offers: string[] }>;
  trades: Array<{ code: string; buyer: string; seller: string; offer: string; fiat: string; state: string; at: string }>;
  failures: string[];
}

export function readSeedSummary(file = SEED_SUMMARY_FILE): SeedSummary | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SeedSummary;
  } catch {
    return null;
  }
}

const STYLE =
  'html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}' +
  'body{margin:0 auto;max-width:640px;padding:16px;background:#0e1116;color:#eef1f5;' +
  'font:400 17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;overflow-wrap:anywhere}' +
  'h1{font-size:24px;line-height:1.25}h2{font-size:19px;margin:28px 0 4px;border-top:1px solid #2a313c;padding-top:16px}' +
  'a{color:#ff8a3d}ul{padding-left:20px;margin:6px 0}li{margin:4px 0}' +
  'code{font:500 15px ui-monospace,Menlo,Consolas,"Roboto Mono",monospace;background:#1b212a;padding:1px 4px;border-radius:4px}' +
  '.who{color:#b7c0cc;font-size:15px}.box{background:#161b22;border-radius:8px;padding:8px 12px;margin:8px 0}' +
  '.notes{color:#ff8a3d;font-size:15px;font-weight:600}h3{font-size:17px;margin:20px 0 4px}';
const CSP = demoPageCsp(STYLE);

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const link = (path: string, text = path): string => `<a href="${esc(path)}">${esc(text)}</a>`;
const login = (name: string): string => `<code>${esc(name)}</code>`;

/** BC time (UTC-7 all year), as the owner reads times. */
function bcTime(iso: string): string {
  const d = new Date(Date.parse(iso) - 7 * 3600_000);
  if (Number.isNaN(d.getTime())) return '?';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} BC time`;
}

type Step = GuideStep;

/** The checklist, in the order one would walk it. */
export function guideSteps(s: SeedSummary | null): Step[] {
  const open = s?.trades.find((t) => t.state === 'setup');
  const closed = s?.trades.find((t) => t.state === 'cancelled');
  const tradeLinks = [open, closed].filter((t) => t !== undefined).map((t) => link(`/trade/${t.code}`, `/trade/${t.code}`));
  return [
    {
      title: '1. Sign up',
      links: [link('/'), link('/setup')],
      who: 'Nobody: make a new account of your own (it gets no door, see Log in).',
      todo: [`Tap Create account; read and sign the Terms (v${TERMS_TEXT_VERSION}); pick a username and a display name; tick the login methods you want.`, 'Save the one recovery code, then type it back on the next screen.', `Paste a payout address when asked (any address shape the form accepts is fine on regtest).${ROUND ? ' "New in this demo" above walks each screen.' : ''}`],
    },
    {
      title: '2. Log in',
      links: [link('/login'), link('/__demo/codes', '/__demo/codes (authenticator codes)')],
      who: `Any seeded account, password ${login(DEMO_PASSWORD)}. Use the login name, not the display name.`,
      todo: ['Type the login name and password.', 'For the 6-digit code, open /__demo/codes in another tab and type that account\'s current code (each code works once; a new one every 30 s).', 'If the account is logged in on another device, log it out there first or approve from it.'],
    },
    {
      title: '3. Browse and buy',
      links: [link('/buy'), link('/buy/ZELLE'), link('/buy/SEPA_INSTANT?currency=EUR', 'SEPA Instant in euros'), link('/buy/FASTER_PAYMENTS?currency=GBP', 'Faster Payments in pounds')],
      who: `${login('ben-demo')} (a trader). The seller must be online for Trade to show: log the seller in on a second device or browser profile.`,
      todo: ['Pick a payment type, open an offer, read the quote, choose an amount.', 'Switch the currency on the payment-type list (USD, CAD, EUR, GBP): lowtide_rx sells for euros and pounds.', 'Tap Trade (seller online) or Message (seller offline).'],
    },
    {
      title: '4. Sell and post an offer',
      links: [link('/sell'), link('/post'), link('/profile/offers', '/profile/offers (My offers)')],
      who: `${login('ana-demo')} (a vendor; only vendors post). ${login('ben-demo')} and ${login('cy-demo')} are traders and do not see Post an offer.`,
      todo: ['Post an offer: side, currencies and bands, payment types and instructions, terms.', 'Pause, edit and remove it on My offers.'],
    },
    {
      title: '5. The trade room and chat',
      links: tradeLinks.length > 0 ? tradeLinks : [link('/trades')],
      who: `A trade you start yourself: ${login('ben-demo')} takes ${login('ana-demo')}'s offer, each in its own browser or device, both kept open from take to settled.`,
      todo: ['Poster: accept on the "accepted your offer" sheet and pick a wallet.', 'Seller: fund (Copy address or Copy amount; the demo faucet pays the escrow, about 30 s for 10 confirmations).', 'Chat both ways in the room once the escrow is secured.'],
    },
    {
      title: '6. Payment proof and blur',
      links: [link('/trades')],
      who: 'The buyer of your own trade, after the escrow is secured.',
      todo: ['Attach a screenshot as payment proof in the room; check what is blurred before it is sent and what the seller sees.', 'Tap I\'ve paid (nothing is really paid on the demo).'],
    },
    {
      title: '7. Release',
      links: [link('/trades')],
      who: 'The seller of your own trade.',
      todo: ['Hold Payment received; the buyer\'s device co-signs; both sides should reach Released.'],
    },
    {
      title: '8. Rating',
      links: [link('/trades')],
      who: 'Both sides of a released trade.',
      todo: ['Rate the other side after release (the next take waits until you rate or skip).', 'See the rating on the other trader\'s profile (/u/<display name>).'],
    },
    {
      title: '9. My trades',
      links: [link('/trades')],
      who: `${login('lowtide-login')} has seeded rows: ${open ? `open ${esc(open.code)} (buying ${esc(open.fiat)} from ${esc(open.seller)}; the API cancels it 60 min after the seed, about ${bcTime(new Date(Date.parse(open.at) + 3600_000).toISOString())}, then it moves to Completed)` : 'no open trade (see the seed notes below)'}${closed ? `; completed ${esc(closed.code)} (cancelled, ${esc(closed.fiat)} with ${esc(closed.seller)})` : ''}.`,
      todo: ['Open and Completed tabs, a row to its room, Show more.', 'Your own trades from steps 5-8 show here too.'],
    },
    {
      title: '10. Wallets',
      links: [link('/wallets')],
      who: 'Any account (each seeded one has one throwaway payout wallet).',
      todo: ['Add a wallet, see the waiting time on a new one, remove one.'],
    },
    {
      title: '11. Team members',
      links: [link('/settings/team')],
      who: `${login('ana-demo')} (vendors have teams).`,
      todo: ['Invite a member, set their boxes; open the invite (/team/join) in another browser.'],
    },
    {
      title: '12. Profile and badges',
      links: [link('/profile'), link('/settings/badges'), link('/settings/record'), link('/u/satoshi_ghost', '/u/satoshi_ghost (someone else\'s)')],
      who: 'Any account.',
      todo: ['Your profile, which badges show, the signed record export; another trader\'s public profile.'],
    },
    {
      title: '13. Alerts',
      links: [link('/settings/alerts', '/settings/alerts (Alerts tab)'), link('/settings/jabber')],
      who: 'Any account.',
      todo: ['Turn the alarm on and test it; push notices; Secure Jabber alerts and which events send one.'],
    },
    {
      title: '14. Security and account',
      links: [link('/settings/security'), link('/settings/devices'), link('/settings/account'), link('/settings/account-type'), link('/settings/blocked'), link('/settings/changes')],
      who: 'Any account.',
      todo: ['Add a passkey or security key (works under this page\'s host name), recovery codes, devices, trader or vendor, blocked traders.'],
    },
    {
      title: '15. Help, news and feedback',
      links: [link('/help'), link('/help/trading'), link('/news'), link('/feedback')],
      who: 'Anyone (help works logged out too).',
      todo: ['The help library and a topic; news; the feedback form.'],
    },
    {
      title: '16. A dispute',
      links: [link('/help/disputes')],
      who: 'The buyer or seller of your own trade, once the escrow is secured.',
      todo: ['In the room, open a dispute (it opens /trade/<code>/dispute): reason, evidence, the waiting screen.', 'Not seeded: the demo has no staff screens (see below), so nobody can take or rule the case here.'],
    },
    {
      title: '17. Staff screens',
      links: [],
      who: 'Not in this demo.',
      todo: ['staff-web is not started by npm run demo, and the staff API listens on 127.0.0.1 only, so moderator and admin screens (case queue, rulings, bans) cannot be shown here.'],
    },
  ];
}


/** The round's new or fixed screens (guide-round.ts; none on main). */
export function newSteps(): NewStep[] {
  return roundSteps({ link, login });
}

const noteList = (n: number[]): string => `Owner notes: ${n.map((x) => `#${x}`).join(', ')}`;

/** The page for this seed summary. */
export function guidePage(s: SeedSummary | null): string {
  const fresh = newSteps()
    .map(
      (st) =>
        `<section data-screen="guide-new-${esc(st.title.slice(0, 1))}" id="new-${esc(st.title.slice(0, 1))}">` +
        `<h3>${esc(st.title)}</h3>` +
        `<div class="notes">${esc(noteList(st.notes))}</div>` +
        (st.links.length > 0 ? `<div>${st.links.join(' · ')}</div>` : '') +
        `<p class="who">${st.who}</p>` +
        `<ul>${st.todo.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`,
    )
    .join('');
  const steps = guideSteps(s)
    .map(
      (st) =>
        `<section data-screen="guide-step-${esc(/^\d+/.exec(st.title)?.[0] ?? 'x')}" id="step-${esc(/^\d+/.exec(st.title)?.[0] ?? 'x')}">` +
        `<h2>${esc(st.title)}</h2>` +
        (st.links.length > 0 ? `<div>${st.links.join(' · ')}</div>` : '') +
        `<p class="who">${st.who}</p>` +
        `<ul>${st.todo.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`,
    )
    .join('');
  const accounts = s
    ? '<div class="box"><b>Yours</b><ul>' +
      s.owner.map((p) => `<li>${login(p.login)}, shown as ${esc(p.shown)} (${p.vendor ? 'vendor' : 'trader'})</li>`).join('') +
      '</ul><b>The cast</b> (offers posted)<ul>' +
      s.cast.map((p) => `<li>${login(p.login)}, shown as ${esc(p.shown)}: ${esc(p.offers.join(', '))}</li>`).join('') +
      '</ul></div>'
    : '<p>The seed has not written its summary yet: is the demo seeded?</p>';
  const failures = s && s.failures.length > 0 ? `<h2>Seed notes</h2><ul>${s.failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>X2F demo guide</title><style>${STYLE}</style>${NOTES_TAG}</head><body data-screen="demo-guide">`,
    '<h1>Demo guide</h1>',
    '<p>Regtest demo only: fake money, throwaway accounts. Leave a comment on any screen with the Comment button (top right), this guide included: tap Comment, then the item you mean, and the comment records which item it is.</p>',
    `<p>Password for every seeded account: <code>${esc(DEMO_PASSWORD)}</code>. Codes: ${link('/__demo/codes')}. One account per browser or device.</p>`,
    `<p>The Terms legal review of 23 Nov: ${link('/__demo/guide/legal', 'Legal suggestions')}.</p>`,
    accounts,
    ...(ROUND && fresh !== ''
      ? [
          `<h2>New in this demo (${esc(ROUND.name)})</h2>`,
          `<p class="who">Built from ${esc(ROUND.builtFrom)}. Each item names the demo note numbers it answers; leave a comment on the screen if it is not what you meant.</p>`,
          fresh,
        ]
      : []),
    '<h2>Everything, screen by screen</h2>',
    steps,
    failures,
    '</body></html>',
  ].join('');
}


/** The Terms legal review the guide's Legal suggestions page shows (owner note #92). */
export const LEGAL_REVIEW_FILE = join(ROOT, 'docs/terms-legal-review-2026-11-23.md');
export const LEGAL_PATH = '/__demo/guide/legal';

/** Inline Markdown: `code`, **bold**, *italic*; everything else escaped. No links or raw HTML. */
function inline(t: string): string {
  return t
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) return `<code>${esc(part.slice(1, -1))}</code>`;
      return esc(part)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
    })
    .join('');
}

/**
 * The small Markdown the review uses, as HTML: # to #### headings, paragraphs, "- " lists (one
 * level of nesting by two spaces), **bold**, `code`. Raw HTML in the file is shown as text.
 */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let depth = 0;
  // Each "### N." proposal (and each "##" part) is a section with its own data-screen, which a
  // comment made on it records (demo r6: the owner comments on each proposal by number).
  let section = false;
  const openSection = (level: number, text: string): void => {
    if (section) out.push('</section>');
    section = false;
    const n = /^(\d+)\./.exec(text);
    let key = '';
    if (level === 4 && n) key = `proposal-${n[1]}`;
    else if (level <= 3) key = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    if (key === '') return;
    out.push(`<section data-screen="legal-${esc(key)}" id="${esc(key)}">`);
    section = true;
  };
  const flushPara = (): void => {
    if (para.length > 0) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeLists = (to: number): void => {
    while (depth > to) {
      out.push('</li></ul>');
      depth -= 1;
    }
  };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^( *)[-*]\s+(.*)$/.exec(line);
    if (line.trim() === '') {
      flushPara();
      continue;
    }
    if (h) {
      flushPara();
      closeLists(0);
      const level = Math.min(4, h[1]!.length + 1);
      openSection(level, h[2]!);
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
    } else if (li) {
      flushPara();
      const want = Math.min(2, Math.floor(li[1]!.length / 2) + 1);
      if (want > depth) {
        while (depth < want) {
          out.push('<ul><li>');
          depth += 1;
        }
      } else {
        closeLists(want);
        out.push('</li><li>');
      }
      out.push(inline(li[2]!));
    } else if (depth > 0 && /^ {2,}\S/.test(raw)) {
      out.push(` ${inline(line.trim())}`);
    } else {
      closeLists(0);
      para.push(line.trim());
    }
  }
  flushPara();
  closeLists(0);
  if (section) out.push('</section>');
  return out.join('');
}

/** /__demo/guide/legal: the review as a page, or a line saying it is missing. */
export function legalPage(md: string | null): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>X2F legal suggestions</title><style>${STYLE}</style>${NOTES_TAG}</head><body data-screen="legal-suggestions">`,
    `<p>${link('/__demo/guide', '← Demo guide')} · ${link('/terms', `Read the Terms (v${TERMS_TEXT_VERSION})`)}</p>`,
    '<h1>Legal suggestions</h1>',
    '<p class="who">The Terms legal review of 23 Nov (your note #92), as written in docs/terms-legal-review-2026-11-23.md. To answer a proposal, tap Comment (top right), then tap that proposal, and type accept, reject or a change: the comment records the proposal\'s number.</p>',
    md === null ? '<p>The review file is not in this demo\'s tree.</p>' : renderMarkdown(md),
    '</body></html>',
  ].join('');
}

function readLegal(file = LEGAL_REVIEW_FILE): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function createGuideHandler(cfg: { origins: Set<string>; summary?: () => SeedSummary | null; legal?: () => string | null }): (req: IncomingMessage, res: ServerResponse) => void {
  const legal = cfg.legal ?? (() => readLegal());
  const hosts = new Set([...cfg.origins].map((o) => new URL(o).host));
  const summary = cfg.summary ?? (() => readSeedSummary());
  return (req, res) => {
    const send = (status: number, type: string, body: string): void => {
      res.writeHead(status, {
        'content-type': type,
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'content-security-policy': CSP,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!hosts.has(req.headers.host ?? '') && !forwardedHttps(req.headers)) return send(403, 'application/json', '{"error":"demo-guide-host"}');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'application/json', '{"error":"demo-guide-method"}');
    const path = (req.url ?? '').split(/[?#]/, 1)[0];
    send(200, 'text/html; charset=utf-8', path === LEGAL_PATH ? legalPage(legal()) : guidePage(summary()));
  };
}
