// Build spec j31a section 1 (T-034, T-080): the "What applies to you" lists, one per reader.
import { describe, expect, it, afterEach, vi } from 'vitest';
import { BLUR_CHECK_LINE, TERMS_SUBTITLE, TRADE_TERMS, termsFor, termsParts, type TermsRole } from '../src/screens/quote/tradeTerms.js';

// The boards' WA_DATA, byte-identical on BuyQuote, SellQuote(+Wide) and OfferAd(+Wide) on
// wip/design-brief (b5bb4faa, 9 Nov 2026), copied verbatim.
const BOARD: Record<TermsRole, { title: string; lines: string[] }[]> = {"seller-taker":[{"title":"Your responsibilities","lines":["Fund the escrow in full.","Send your payment details from the card in the trade chat: it asks for that method's fields and posts them as one message.","Pick the currency, then the payment type, on the ad.","Gift card: check it within 45 minutes of getting its details."]},{"title":"What affects you","lines":["The buyer only sees \"Pay now\" once your escrow is secured.","The buyer can cancel until they tap \"I've paid\"; your XMR comes back.","After \"I've paid\", the buyer waits for the payment method's transfer time before a dispute (Zelle: 90 min). It's shown where the method is picked.","Once the buyer taps \"I've paid\", neither of you can cancel.","After the time to pay, the buyer can still pay until you cancel. If they paid and you cancel, they can dispute at once.","Before the XMR is released, a pop-up asks you to confirm the payment arrived. You can turn it off.","Proofs show the trade code, amount and time; our privacy tool hides names and account numbers.","[lead writes the wording]","You're warned if a proof has no readable date.","Maintenance pauses the trade timers.","On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides.","In a dispute, a moderator steps in within 24 hours at most.","A ruling moves the coins at once; a lien covers a reversal.","Feedback and your totals follow the final outcome."]},{"title":"Your options","lines":["Opened trades with several people to see who answers first? Close the others once you've picked one, so they aren't left waiting.","Buyer gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.","Before you fund: cancel at once.","If the time to pay expires with no \"I've paid\", the trade is still open. You can cancel for a full refund (it starts right away and is done at 10 confirmations), wait for them to reply, or nudge them every 15 min."]}],"buyer-taker":[{"title":"Your responsibilities","lines":["Pay only when \"Pay now\" shows; it never shows before the escrow is secured.","Pick the currency, then the payment type, on the ad.","Follow the payment instructions for the type you picked.","Tap \"I've paid\" once the money is sent.","We recommend paying from an account in your own name: it lowers the chance of the payment being frozen. We protect your identity either way.","Post proof with the trade code, amount and time visible.","Gift card: bought in the last 30 days, full written value, and a video of you logging into it before you send."]},{"title":"What affects you","lines":["Amounts can be shown with or without the vendor's markup.","The ad may need 5, 10, 25 or 50 completed trades from you.","Our privacy tool hides names and account numbers in your proof; the trade code, amount and time stay visible.","[lead writes the wording]","If our privacy tool hides the trade code, or there's no readable date, you're warned and can still post.","Once you tap \"I've paid\", neither of you can cancel.","After the time to pay, the trade stays open until the seller cancels: you can still message and pay. If you paid and they cancel, you can dispute at once.","Before \"I've paid\" goes through, a pop-up asks you to confirm. You can turn it off.","Maintenance pauses the trade timers.","On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides.","In a dispute, a moderator steps in within 24 hours at most.","A ruling moves the coins at once; a lien covers a reversal.","Feedback and your totals follow the final outcome."]},{"title":"Your options","lines":["Opened trades with several people to see who answers first? Close the others once you've picked one, so they aren't left waiting.","Seller gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.","Cancel until you tap \"I've paid\"; you're warned first that it's likely final.","After \"I've paid\", only a dispute, after the payment method's transfer time (Zelle: 90 min, shown where you pick the method).","Post proof even if the amount isn't detected; X2F logs it to improve."]}],"poster-selling":[{"title":"Your responsibilities","lines":["Answer a trade request within 60 minutes, or it closes.","Fund the escrow in full.","Send your payment details from the card in the trade chat: it asks for that method's fields and posts them as one message.","Gift card: check it within 45 minutes of getting its details."]},{"title":"What affects you","lines":["You escrow the trade plus 1% (the X2F fee); the buyer gets the full amount.","No fee on a full reversal; during an appeal the fee waits for the outcome.","The buyer only sees \"Pay now\" once your escrow is secured.","The buyer can cancel until they tap \"I've paid\"; your XMR comes back.","After \"I've paid\", the buyer waits for the payment method's transfer time before a dispute (Zelle: 90 min). It's shown where the method is picked.","Once the buyer taps \"I've paid\", neither of you can cancel.","After the time to pay, the buyer can still pay until you cancel. If they paid and you cancel, they can dispute at once.","Before the XMR is released, a pop-up asks you to confirm the payment arrived. You can turn it off.","Proofs show the trade code, amount and time; our privacy tool hides names and account numbers.","[lead writes the wording]","You're warned if a proof has no readable date.","Maintenance pauses the trade timers.","On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides.","In a dispute, a moderator steps in within 24 hours at most.","A ruling moves the coins at once; a lien covers a reversal.","Feedback and your totals follow the final outcome."]},{"title":"Your options","lines":["Buyer gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.","Before you fund: cancel at once.","If the time to pay expires with no \"I've paid\", the trade is still open. You can cancel for a full refund (it starts right away and is done at 10 confirmations), wait for them to reply, or nudge them every 15 min."]}],"poster-buying":[{"title":"Your responsibilities","lines":["Answer a trade request within 60 minutes, or it closes.","Pay only when \"Pay now\" shows; it never shows before the escrow is secured.","Tap \"I've paid\" once the money is sent.","We recommend paying from an account in your own name: it lowers the chance of the payment being frozen. We protect your identity either way.","Post proof with the trade code, amount and time visible.","Gift card: bought in the last 30 days, full written value, and a video of you logging into it before you send."]},{"title":"What affects you","lines":["You receive the XMR less 1% (the X2F fee) and the network fee for your payout.","No fee on a full reversal; during an appeal the fee waits for the outcome.","Our privacy tool hides names and account numbers in your proof; the trade code, amount and time stay visible.","[lead writes the wording]","If our privacy tool hides the trade code, or there's no readable date, you're warned and can still post.","Once you tap \"I've paid\", neither of you can cancel.","After the time to pay, the trade stays open until the seller cancels: you can still message and pay. If you paid and they cancel, you can dispute at once.","Before \"I've paid\" goes through, a pop-up asks you to confirm. You can turn it off.","Maintenance pauses the trade timers.","On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides.","In a dispute, a moderator steps in within 24 hours at most.","A ruling moves the coins at once; a lien covers a reversal.","Feedback and your totals follow the final outcome."]},{"title":"Your options","lines":["Seller gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.","Cancel until you tap \"I've paid\"; you're warned first that it's likely final.","After \"I've paid\", only a dispute, after the payment method's transfer time (Zelle: 90 min, shown where you pick the method).","Post proof even if the amount isn't detected; X2F logs it to improve."]}]};

/** The lead's placeholder (p9-8, Q47): on the board, never shipped. */
const PLACEHOLDER = '[lead writes the wording]';
const ROLES = Object.keys(BOARD) as TermsRole[];
const lines = (role: TermsRole) => TRADE_TERMS[role].flatMap((g) => g.lines);

describe('trade terms by reader (T-034, T-080)', () => {
  it("every list is the board's, word for word, in order, with the first-weeks check line where the placeholder was (P-012/P-013)", () => {
    // Page 11's recommended wording (option 1, not answered yet: COPY-UNSIGNED).
    expect(BLUR_CHECK_LINE).toBe('For the first weeks we ask after every proof whether our privacy tool hid the right details. It takes one tap.');
    for (const role of ROLES) {
      const want = BOARD[role].map((g) => ({ title: g.title, lines: g.lines.map((l) => (l === PLACEHOLDER ? BLUR_CHECK_LINE : l)) }));
      expect(TRADE_TERMS[role].map((g) => ({ title: g.title, lines: [...g.lines] }))).toEqual(want);
    }
  });

  it('never ships the placeholder line', () => {
    for (const role of ROLES) expect(lines(role)).not.toContain(PLACEHOLDER);
  });

  it('the X2F fee lines are in the two poster lists only', () => {
    const fee = /X2F fee|No fee on a full reversal/;
    for (const role of ['seller-taker', 'buyer-taker'] as const) expect(lines(role).filter((l) => fee.test(l))).toEqual([]);
    expect(lines('poster-selling').filter((l) => fee.test(l))).toHaveLength(2);
    expect(lines('poster-buying').filter((l) => fee.test(l))).toHaveLength(2);
  });

  it('the courtesy line is in the two taker lists only; the nudge line is in all four, under Your options', () => {
    const courtesy = (r: TermsRole) => lines(r).some((l) => l.startsWith('Opened trades with several people'));
    expect(courtesy('seller-taker') && courtesy('buyer-taker')).toBe(true);
    expect(courtesy('poster-selling') || courtesy('poster-buying')).toBe(false);
    for (const role of ROLES) {
      const options = TRADE_TERMS[role].find((g) => g.title === 'Your options')!.lines;
      expect(options.filter((l) => / gone quiet\? Nudge them/.test(l))).toHaveLength(1);
    }
    expect(lines('buyer-taker').join(' ')).toContain('Seller gone quiet?');
    expect(lines('seller-taker').join(' ')).toContain('Buyer gone quiet?');
  });

  it('the subtitles', () => {
    expect(TERMS_SUBTITLE['buyer-taker']).toBe("You're buying from a sell ad · information only");
    expect(TERMS_SUBTITLE['seller-taker']).toBe("You're selling to a buy ad · information only");
    expect(TERMS_SUBTITLE['poster-selling']).toBe('A trade on your sell ad · information only');
    expect(TERMS_SUBTITLE['poster-buying']).toBe('A trade on your buy ad · information only');
  });

  it("numbers are cut out for the mono face, on the board's pattern", () => {
    expect(termsParts('You escrow the trade plus 1% (the X2F fee)')).toEqual([
      { text: 'You escrow the trade plus ', mono: false },
      { text: '1%', mono: true },
      { text: ' (the X', mono: false },
      { text: '2', mono: true },
      { text: 'F fee)', mono: false },
    ]);
  });
});

describe('the blur-check line waits for the upload (review of the proof stack, S-M2, lead 12 Nov)', () => {
  // It promises an ask (BlurCheck) that is not mounted yet, in words not signed yet: on the quote
  // screen only in a build with the proof upload (VITE_X2F_PROOF_UPLOAD=1, proofUploadOn).
  afterEach(() => vi.unstubAllEnvs());

  it('flag off (the default): termsFor leaves it out of all four lists, and nothing else', () => {
    vi.stubEnv('VITE_X2F_PROOF_UPLOAD', '');
    for (const role of ROLES) {
      const shown = termsFor(role);
      expect(shown.flatMap((g) => g.lines), role).not.toContain(BLUR_CHECK_LINE);
      expect(shown.map((g) => [g.title, [...g.lines]]), role).toEqual(TRADE_TERMS[role].map((g) => [g.title, g.lines.filter((l) => l !== BLUR_CHECK_LINE)]));
    }
  });

  it('flag on: the full board, the line included', () => {
    vi.stubEnv('VITE_X2F_PROOF_UPLOAD', '1');
    for (const role of ROLES) expect(termsFor(role).map((g) => [g.title, [...g.lines]])).toEqual(TRADE_TERMS[role].map((g) => [g.title, [...g.lines]]));
  });
});
