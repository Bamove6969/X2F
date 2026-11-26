// Plan 5 Task 21: copy-lint's `refusal` rule (every refusal goes through CantDoThat), the owner-wording
// exemption, the ratchet on refusals still shown inline, and the Claude Design tripwire.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TODO_PRAGMA, countPragmas, lintSource } from '../../../tools/copy-lint.js';
import { CANT_DO_CODES, NOT_REFUSAL_CODES } from '../src/ui/cantDoCodes.js';
import { FEEDBACK_THANKS } from '../src/screens/Feedback.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

const lint = (src: string, file = 'a.tsx') => lintSource(src, file).filter((f) => f.rule === 'refusal').map((f) => f.text);
const IMPORT = "import { CantDoThat } from '../ui/CantDoThat.js';\nimport { isCantDoCode } from '../ui/cantDoCodes.js';\n";

describe('copy-lint: every refusal goes through CantDoThat, judged piece by piece', () => {
  it('flags refusal wording and refusal code literals', () => {
    expect(lint('export const a = "You can\'t post offers.";\n', 'a.ts')).toEqual(["You can't post offers."]);
    expect(lint('export const A = () => <p>Sorry, you are limited to 2 offers.</p>;\n')).toEqual(['Sorry, you are limited to 2 offers.']);
    expect(lint("export const f = (c: string) => c === 'trading-hold';\n", 'a.ts')).toEqual(['trading-hold']);
  });

  it('review I2: importing CantDoThat or cantDoCodes exempts nothing, a type-only or bare import least of all', () => {
    const refusal = "export const A = () => <p>Sorry, you're limited to 2 offers per side.</p>;\n";
    expect(lint(IMPORT + refusal)).toEqual(["Sorry, you're limited to 2 offers per side."]);
    expect(lint("import type { CantDoCode } from '../ui/cantDoCodes.js';\n" + refusal)).toHaveLength(1);
    expect(lint("import '../ui/CantDoThat.js';\n" + refusal)).toHaveLength(1);
  });

  it('review I2: takeErrors.ts\'s old already-waiting line is caught; the real file now takes it from the text map', () => {
    const old = `${IMPORT}export function t(code: string) {\n  switch (code) {\n    case 'already-waiting':\n      return 'You already have a trade on this offer waiting to be funded.';\n  }\n}\n`;
    expect(lint(old, 'takeErrors.ts')).toEqual(['already-waiting', 'You already have a trade on this offer waiting to be funded.']);
    const real = readFileSync(join(SRC, 'screens/quote/takeErrors.ts'), 'utf8');
    expect(real).not.toContain('You already have a trade');
    expect(lintSource(real, 'apps/web/src/screens/quote/takeErrors.ts')).toEqual([]);
  });

  it('passes text written straight into <CantDoThat title= body=>, and the text map itself', () => {
    expect(lint(`${IMPORT}export const A = () => <CantDoThat title="You can't do that" body={"Sorry, you're limited to 2."} from="too-many-offers" onClose={() => {}} />;\n`)).toEqual([]);
    // ...but not text beside it.
    expect(lint(`${IMPORT}export const A = () => <><CantDoThat title="x" body="y" from="lien" onClose={() => {}} /><p>You can't trade.</p></>;\n`)).toEqual(["You can't trade."]);
    expect(lint('export const a = "You can\'t post offers.";\n', 'apps/web/src/ui/cantDoCodes.ts')).toEqual([]);
  });

  it('review I3: the wider refusal wording is caught', () => {
    for (const s of [
      'You are unable to post.',
      'You are not able to post.',
      "You couldn't post that offer.",
      'You can nudge once every 10 minutes.',
      'You already have 5 security keys.',
      'A maximum of 20 offers.',
      'That is not permitted.',
      'Too many offers.',
      "This method isn't available for you.",
      'This offer needs at least 5 completed trades.',
      'You have at most 2 offers.',
      'Only 2 offers per side.',
      'Your account is blocked.',
    ]) {
      expect(lint(`export const a = ${JSON.stringify(s)};\n`, 'a.ts'), s).toEqual([s]);
    }
    // A piece that starts like a fault report and holds no strong rule word is not judged.
    for (const fault of [
      'Could not save that. Try again.',
      'Offers could not be loaded right now. Try again in a moment.',
      "X2F could not use that key. Check that you pasted the whole public key.",
      "Your device can't settle this trade as the server shows it. Don't send any money.",
      'Too many tries. Try again in 5 minutes.',
    ]) {
      expect(lint(`export const a = ${JSON.stringify(fault)};\n`, 'a.ts'), fault).toEqual([]);
    }
  });

  it('round-2 N-M1: a refusal that merely ends with "Try again" or mentions a device is still judged', () => {
    for (const s of [
      'You can only nudge once every 10 minutes. Try again later.',
      "You can't post more than 2 offers per side. Try again once one ends.",
      "Your account is on a trading hold, so you can't trade. Try again after the dispute.",
      "You can't add another security key to your device list: the limit is 5.",
      "Sorry, you're limited to 2 offers per side. Reload the page after removing one.",
      // A fault opener with a strong rule word in it is judged too.
      "Could not post: you're limited to 2 offers per side.",
    ]) {
      expect(lint(`export const a = ${JSON.stringify(s)};\n`, 'a.ts'), s).toEqual([s]);
    }
    // A literal type is never shown.
    expect(lint("export type R = { result: 'too-soon' };\n", 'a.ts')).toEqual([]);
  });

  it('review M8: a pragma counts only in a real comment, and covers its own line and the next', () => {
    expect(lint('// not-a-refusal: explains storage\nexport const a = "It can\'t be undone.";\n', 'a.ts')).toEqual([]);
    expect(lint(`export const a = "You can't post offers."; // ${TODO_PRAGMA} later\n`, 'a.ts')).toEqual([]);
    expect(lint('export const A = () => <p>{/* not-a-refusal: explains */}It can\'t be undone.</p>;\n')).toEqual([]);
    // Inside a string it is just text.
    expect(lint('export const p = "not-a-refusal: sneaky";\nexport const a = "You can\'t post offers.";\n', 'a.ts')).toEqual(["You can't post offers."]);
    expect(lint('export const A = () => <p>not-a-refusal: sneaky</p>;\nexport const a = "You can\'t.";\n')).toEqual(["You can't."]);
    // Two lines down is out of reach.
    expect(lint('// not-a-refusal: x\nconst b = 1;\nexport const a = "You can\'t.";\n', 'a.ts')).toEqual(["You can't."]);
    expect(countPragmas('// not-a-refusal: x\nconst s = "not-a-refusal: y";\n// cant-do-that-todo: z\n', 'a.ts')).toEqual({ notARefusal: 1, todo: 1 });
  });

  it('lets the owner\'s exact thank-you keep its "!", and nothing else', () => {
    expect(lintSource(`export const t = ${JSON.stringify(FEEDBACK_THANKS)};\n`, 'a.ts')).toEqual([]);
    expect(lintSource('export const t = "Thank you!";\n', 'a.ts').map((f) => f.rule)).toEqual(['exclamation']);
  });

  it('counts both pragmas, so neither can grow unnoticed (review M8)', () => {
    let notARefusal = 0;
    let todo = 0;
    for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.(tsx?|jsx?)$/.test(e.name) || /^(cantDoCodes\.ts|CantDoThat\.tsx)$/.test(e.name)) continue;
      const c = countPragmas(readFileSync(join(e.parentPath, e.name), 'utf8'), e.name);
      notARefusal += c.notARefusal;
      todo += c.todo;
    }
    // 2026-10-29. `cant-do-that-todo`: auth/refusals.ts (recovery-hold, security-key-limit and its
    // sentence, login-name-set), listed with their owner in docs/coordination.md. Lower these as
    // refusals move into CantDoThat; raise one only with a reviewed reason. `not-a-refusal` 40 -> 43
    // (Task 37 landing, 2026-10-29): settings/blockCopy.ts's three lines saying what a block stops
    // the OTHER trader doing ("<name> can't: ...", the done note, "What blocking does"). 43 -> 45
    // (Tasks 38-39 landing, 2026-10-29): two warnings that explain, not refuse: PaidConfirmSheet's
    // "After this you can't cancel the trade" and ReleaseWarning's "... and can't be taken back."
    expect(todo).toBeLessThanOrEqual(4);
    // 45 -> 50 (C2-D1, 1 Nov 2026): the LoginApprove and Devices boards' explanations, not rules:
    // what blocking a login did, the advice after a block, why no place is shown, the blocked new
    // device's note, and how approval works. 50 -> 51 (C11, design review fix 2): the DisputeRuling
    // board's "If an appeal overturns the ruling, you get a lien. You can't trade until you pay the
    // XMR back." explains a consequence before any appeal (dispute/rules.ts overturnLien). 51 -> 52
    // (Plan 4 Task 15, 6 Nov 2026): owner Q38's hourglass says the time left ("... at most",
    // DisputeRoom.tsx), not a rule. 52 -> 53 (batch 3 landing, 5b3b38c5): the front door's Landing
    // board promise that X2F "can't move them alone" (Landing.tsx) reassures about escrow, not a rule.
    // 53 -> 56 (results-port db357970, batch 4): design results' BuyerPaidWaiting "You can't cancel
    // after marking as paid", said ahead of time, the Feedback anonymous hint "we can't follow up with
    // you", and Refunded's "Until they pay it back, they can't trade." (design's wording 7 Nov), which
    // explains a ruling about the other trader. 56 -> 58 (trade-copy e47e8e43, J-31, 9 Nov 2026: one
    // pragma per shared line in quote/tradeTerms.ts, two lines): the nudge line's pace ("at most once every 15
    // minutes", encouraged by the owner, p6-1) and the moderator's response time ("within 24 hours
    // at most"), which explain, not refuse. 58 -> 59 (offer-rules 32744fdd, J-02): the percentage box's
    // input check on PostOffer ("an input check on the percentage box"), a field rule, not a refusal.
    // 59 -> 61 (pay-details 2b54fe67, batch 4): ChatPanel's payErrorText field hints ("has too many lines",
    // "can't have line breaks", "can't have tabs or hidden characters"), input checks on the payment-details boxes.
    // 61 -> 64 (flex-launch, J-16, 10 Nov 2026): PostOffer's band input checks in post/offerForm.ts (MIN_OVER_MAX
    // "can't be more than the largest", the bands' gap line, a band's margin plus a method's change "can't pass 50%"):
    // field rules the API's checkBands and rateFor share, not refusals.
    // 64 -> 65 (owner item 64, 3 Nov 2026; proof pop-ups landed 10 Nov): screens/proof/ProofPrompts.tsx's
    // "Our automated system was unable to detect the amount ..." is a check on the screenshot asking
    // for an explanation; the proof can still be sent. 65 -> 66 (jabber-settings F1, 23fe5783, batch 8):
    // jabberCopy.ts's always-on note under the disabled security box, a standing note; nothing was tried.
    // 66 -> 67 (owner demo notes 12 Nov 2026): sessionCopy.ts's askHint, the owner's own words ("If you
    // are unable to confirm your identity at that time, your account will be logged out ..."), a hint
    // shown before the session ends; nothing was refused.
    // 67 -> 68 (Plan 5 Task 15, proof upload): proof/upload.ts's PROOF_CANT_USE ("This image can't be
    // used. Try a screenshot."), an input check on the picked image (Review Focus 2); another can be picked.
    // 68 -> 69 (NEEDS_PROOF_RECEIVE): screens/proof/ChatProof.tsx's CHAT_PROOF_GONE ("This proof is no
    // longer stored."), a note in place of a proof past its retention, not a rule the user ran into.
    // 69 -> 70 (Plan 5 Task 12, wip/lead-profile; train-1 merge, the proof upload's +2 and the profile's
    // +1 summed on 67): the BadgeSettings board's standing footer "The New badge always shows
    // while you have it and can't be hidden." (profile/profileCopy.ts), on every visit; New's row has
    // no controls, so nothing is ever tried and refused.
    // 70 -> 71 (gap 4 no-show refund, review m5 and n1, 21 Nov 2026): SellerRefund.tsx's stopped-escrow
    // status line "stopped for good, so it can't finish this refund", a device fault reported to the
    // seller; the seller tried nothing and nothing was refused. (A second line was unreachable and removed.)
    // 71 -> 72 (wip/lead-sanctions, payee-fields-2 m-4): ChatPanel.tsx's UNREADABLE_PAY_LINE ("Their payment details couldn't be shown. Ask them to send again."), a status line in place of a package this device refused for its contents; the payer tried nothing and nothing was refused.
    // 72 -> 73 (Plan 4 Task 27, bans, counted 71 -> 72 on wip/lead-bans-2 and first counted 65 -> 66 on wip/lead-bans 12 Nov 2026): the ban
    // notice's lead (screens/account/AccountBanned.tsx, owner G39 draft) is a full-screen notice
    // of the ban itself, not a refused action.
    // 73 -> 72 (wip/lead-notes-integ, wip/third-demo-r3's sign-up round 3 merged onto main a981b348):
    // setup/Backup.tsx's one goes (its second-PGP-key input check moved out with the round-3 backup step).
    // The round's other counts (the tour's two notes, UNREADABLE_PAY_LINE) were already counted above.
    // 72 -> 73 (wip/lead-notes-all, Terms v2026-11-23, owner demo note #106, 17 Nov): setup/termsText.ts's
    // late-payment bullet in the owner's own words ("you can't figure it out amicably ... call upon a
    // moderator"), Terms text that explains, not a refusal (counted 69 -> 70 on wip/lead-note-terms).
    // 73 -> 75 (wip/lead-note-landing, owner demo notes #122 and #135, 23 Nov): setup/termsText.ts's
    // zero-log paragraph ("we do not collect or retain ..."), Terms text that explains, not a refusal;
    // and setup/Login.tsx's authenticator-app explanation ("If you cannot scan the QR code, you can
    // enter the setup key manually."), how setup works; nothing was tried and refused. 75 -> 76
    // (owner demo note #137, 23 Nov): setup/Login.tsx's authenticator-app second paragraph ("Security
    // Level: Medium. We strongly recommend ..."), advice on choosing login methods, not a refusal.
    // Owner demo note #139 (23 Nov): the password option's "Security Level: Low…" paragraph explains
    // the risk of a password-only account; nothing was tried and refused. 76 -> 77
    // 77 -> 78 (wip/lead-note-196, owner demo notes #195 and #196, 25 Nov): setup/Username.tsx's lead
    // in the owner's words ("Your display name cannot be traced back to your login username"), a
    // privacy reassurance, not a refusal.
    // 78 -> 81 (wip/lead-note-223, the owner's full-length Terms, 25 Nov): setup/termsText.ts's
    // sentences with "cannot" ("cannot be restored", "cannot pull back funds", "cannot resolve it",
    // "we do not collect") each carry their own pragma; they explain how X2F works, nothing was tried and refused.
    // 81 -> 83 (wip/lead-team-ui, Job 1c): settings/teamApi.ts's Availability type and its parse set
    // name the catalogue's 'owner-only' box kind (a kind of permission box), not a refusal code.
    // 83 -> 84 (wip/third-lien-recovery merged onto main, 26 Nov): liensCopy.ts's `addressTaken` (lien recovery,
    // provisional owner answer Q2, 17 Nov 2026), a wallet choice to redo on the same screen, not a rule refusal.
    // 84 -> 89 (owner open-items walkthrough, 26 Nov): termsText.ts's section 1 ("cannot move them on its
    // own") and the four TERMS_CHANGES lines, a summary of what changed in the Terms; nothing was tried and refused.
    expect(notARefusal).toBeLessThanOrEqual(89);
    // Parses every file under apps/web/src: give it room on a loaded machine.
  }, 60_000);
});

describe('review I3: every error code the web knows is classified', () => {
  const API = readFileSync(join(ROOT, 'apps/api/src/errors.ts'), 'utf8');
  const KEYS = readFileSync(join(ROOT, 'packages/accounts/src/pgp.ts'), 'utf8');
  const union = (src: string, name: string) => {
    const at = src.indexOf(`export type ${name} =`);
    expect(at, name).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf(';', at));
    return [...body.matchAll(/\| '([a-z0-9-]+)'/g)].map((m) => m[1]!);
  };

  /** Codes the web compares against: `.code === 'x'`, `.code !== 'x'`, and `case 'x':` in a `switch (….code)`. */
  function webCodes(): Set<string> {
    const out = new Set<string>();
    for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.(tsx?|jsx?)$/.test(e.name)) continue;
      const src = readFileSync(join(e.parentPath, e.name), 'utf8');
      // `typeof x.code === 'string'` is a type check, not a code.
      for (const m of src.matchAll(/\.code\s*[!=]==\s*'([a-z0-9-]+)'/g)) if (!['string', 'number', 'undefined', 'object'].includes(m[1]!)) out.add(m[1]!);
      for (const sw of src.matchAll(/switch \((?:[\w.]+\.)?code\) \{/g)) {
        let depth = 0;
        let i = sw.index + sw[0].length - 1;
        for (; i < src.length; i++) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}' && --depth === 0) break;
        }
        for (const c of src.slice(sw.index, i).matchAll(/case '([a-z0-9-]+)':/g)) out.add(c[1]!);
      }
    }
    return out;
  }

  it('in CANT_DO_CODES or NOT_REFUSAL_CODES, never both', () => {
    const cant = new Set<string>(CANT_DO_CODES);
    for (const c of Object.keys(NOT_REFUSAL_CODES)) expect(cant.has(c), c).toBe(false);
    const known = new Set([...union(API, 'ApiErrorCode'), ...union(KEYS, 'KeyRefusal'), ...webCodes()]);
    expect(known.size).toBeGreaterThan(60);
    const unclassified = [...known].filter((c) => !cant.has(c) && !Object.hasOwn(NOT_REFUSAL_CODES, c));
    expect(unclassified, 'classify each new code in apps/web/src/ui/cantDoCodes.ts').toEqual([]);
  });

  it('the review I1 code is the API\'s own', () => {
    expect(union(API, 'ApiErrorCode')).toContain('last-login-method');
    expect(CANT_DO_CODES).toContain('last-login-method');
    expect(CANT_DO_CODES).not.toContain('only-login' as never);
  });
});

// TRIPWIRE (local tree only): there are no Claude Design boards yet for the popup or the form (brief
// ~/x2f-comms/design-brief-2026-10-29.md, items 4 and 5; the owner wants Claude Design to decide all
// aesthetics). Both are built from the existing kit (Sheet, Button, screens.css classes) with no
// styling of their own and have no parity entry. When the boards land, match CantDoThat and
// Feedback to them, add expectParity entries for both, and delete this tripwire.
describe('Task 21 waits for its Claude Design boards', () => {
  it('NEEDS_DESIGN_CANTDOTHAT: no board for CantDoThat or the feedback form yet', () => {
    const boards = join(ROOT, 'design/x2f-app');
    const names = existsSync(boards) ? readdirSync(boards, { recursive: true }).map(String) : [];
    expect(names.filter((n) => /cant-?do|feedback/i.test(n)), 'a CantDoThat or Feedback board landed: match the screens to it').toEqual([]);
  });
});

// Review M1: on a real touch screen the browser takes a drag on the scrolling sheet as a pan and
// sends pointercancel. The grab handle opts out (touch-action: none) and is at least 44 px tall.
describe('the sheet grab handle takes the touch gesture', () => {
  it('touch-action: none and a 44 px hit area', () => {
    const css = readFileSync(join(SRC, 'ui/ui.css'), 'utf8');
    const rule = /\.x2f-sheet__handle \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/touch-action:\s*none;/);
    expect(rule).toMatch(/height:\s*44px;/);
  });
});
