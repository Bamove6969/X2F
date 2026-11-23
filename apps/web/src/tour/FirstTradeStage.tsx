/**
 * The first-trade tour's example screens (design, wip/design-brief b3b8315b: tour-stops.md §2 and
 * tour-motion.md §4-5, after tour-art/x2f-intro-prototype.html): Find a trade, Offers, Quote, Fund,
 * Trade room, Check and release, Released, all on the one pretend trade (market $329.90; example_seller pays 2%
 * above it, $336.50, and takes $50 to $1,000; 0.594354 XMR for $200.00 by Cash App, trade
 * K7M2-9QXA-4FTR-8WPN). Every screen after Find a trade carries the Example chip (head designer's
 * ruling, 12 Nov); Find a trade says its counts and rates are examples.
 *
 * Nothing here talks to the API or touches the real screens: the tour draws these itself. What each
 * screen shows is a function of the stop and whether its action has played, so Back undoes it.
 *
 * COPY-UNSIGNED: every string (design's mock-screen strings; tour-motion.md §9 lists those awaiting
 * the owner). DESIGNER-REVIEW: a compact build of the prototype's screens, not a pixel port.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../ui/icons.js';
import { Logo } from '../ui/Logo.js';
import { ONE_KEY_ALONE, RELEASE_IS_FINAL } from '../screens/trade/escrowCopy.js';
import type { TourStageProps } from './engine.js';
import './stage.css';

/** The stop (0-based) each screen starts on. */
const SCREENS = [0, 5, 10, 12, 14, 16, 18] as const;
export function screenOf(stop: number): number {
  let s = 0;
  SCREENS.forEach((start, i) => {
    if (stop >= start) s = i;
  });
  return s;
}

const AMOUNT = '0.594354';
const RATE_CENTS = 33650;
const usd = (xmr: string) => {
  const n = Number(xmr === '' ? '0' : xmr);
  const cents = Math.round(n * RATE_CENTS);
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** The trade room's stops and the two after it (0-based), as firstTradeTour.ts orders them. */
const STOP = { room: 14, chat: 15, paid: 16, release: 17 } as const;

/** Whether stop `n`'s action has happened by now (an earlier stop, or this one once it has played). */
const done = (stop: number, acted: boolean, n: number) => stop > n || (stop === n && acted);

function Example() {
  return (
    <span className="x2f-ex__chip" data-part="example">
      Example
    </span>
  );
}

function Who({ sub }: { sub: string }) {
  return (
    <div className="x2f-ex__who">
      <span className="x2f-ex__avatar" data-online="true" aria-hidden="true">
        ES
      </span>
      <span className="x2f-ex__name">
        <span>
          example_seller <span className="x2f-ex__vendor">Vendor</span>
        </span>
        <small>{sub}</small>
      </span>
    </div>
  );
}

const METHODS = {
  EUR: [
    ['Revolut', 14, '€305.70'],
    ['Wise', 9, '€306.40'],
    ['PayPal', 6, '€309.20'],
    ['Bizum', 3, '€307.90'],
  ],
  USD: [
    ['Cash App', 23, '$333.30'],
    ['Zelle', 34, '$330.40'],
    ['Venmo', 10, '$334.20'],
    ['PayPal', 8, '$331.10'],
  ],
} as const;

function FindATrade({ stop, acted }: TourStageProps) {
  const sell = done(stop, acted, 1);
  const usdOn = done(stop, acted, 2);
  const picked = done(stop, acted, 3);
  // Stop 3: the menu opens, USD is picked, and it closes (tour-motion.md §5).
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (stop !== 2 || !acted) return setMenu(false);
    setMenu(true);
    const id = setTimeout(() => setMenu(false), 900);
    return () => clearTimeout(id);
  }, [stop, acted]);
  const cur = usdOn && !menu ? 'USD' : 'EUR';
  const who = sell ? 'buyers' : 'sellers';
  return (
    <>
      <header className="x2f-ex__head">
        <div className="x2f-ex__brand">
          <Logo size={24} decorative />
          <span className="x2f-ex__title-sm">Find a trade</span>
        </div>
        <div className="x2f-ex__seg" role="tablist" aria-label="Buy or sell" data-tour="seg">
          <span role="tab" aria-selected={!sell} className="x2f-ex__pill" data-tour="buy">
            Buy
          </span>
          <span role="tab" aria-selected={sell} className="x2f-ex__pill" data-tour="sell">
            Sell
          </span>
        </div>
        <h1 className="x2f-ex__h1">{sell ? 'How do you want to be paid?' : 'How do you want to pay?'}</h1>
      </header>
      <section className="x2f-ex__wash" aria-label="Market price" data-tour="market">
        <div className="x2f-ex__row">
          <span className="x2f-ex__cap">Market price</span>
          <span className="x2f-ex__curbtn" data-tour="cur">
            {cur} <Icon name="chevron-down" size={16} />
          </span>
        </div>
        {menu ? (
          <div className="x2f-ex__menu" role="listbox" aria-label="Currency">
            {(['USD', 'EUR', 'GBP', 'CAD'] as const).map((c) => (
              <span key={c} role="option" aria-selected={c === 'USD'} className="x2f-ex__opt">
                {c}
              </span>
            ))}
          </div>
        ) : null}
        <span className="x2f-ex__big">
          {cur === 'USD' ? '$329.90' : '€306.10'} <small>/ XMR</small>
        </span>
        <span className="x2f-ex__muted">Market rate · updated 14:05 UTC</span>
      </section>
      <section>
        <h2 className="x2f-ex__sech">Payment apps</h2>
        <div className="x2f-ex__list" data-tour="methods">
          {METHODS[cur].map(([name, n, from], i) => {
            const on = cur === 'USD' && i === 0 && picked;
            return (
              <div key={name} className="x2f-ex__mrow" data-on={on ? 'true' : 'false'} data-tour={cur === 'USD' && i === 0 ? 'cash' : undefined}>
                <span className="x2f-ex__mname">
                  <span>{name}</span>
                  <small>
                    {n} {who} taking {cur} · from {from}
                  </small>
                </span>
                <Icon name={on ? 'check' : 'chevron-right'} size={18} />
              </div>
            );
          })}
        </div>
      </section>
      <p className="x2f-ex__muted">Counts and rates are examples.</p>
    </>
  );
}

function Offers({ stop, acted }: TourStageProps) {
  const pressed = done(stop, acted, 9);
  return (
    <>
      <header className="x2f-ex__head" data-tour="ohead">
        <span className="x2f-ex__meta">
          23 buyers · USD · <Example />
        </span>
        <h1 className="x2f-ex__h1">Sell XMR via Cash App</h1>
      </header>
      <div className="x2f-ex__mktrow">
        <span className="x2f-ex__muted">Market price</span> <span className="x2f-ex__mono">$329.90</span> <small>/ XMR</small>
      </div>
      <article className="x2f-ex__offer" data-tour="offer1" data-pressed={pressed ? 'true' : 'false'}>
        <Who sub="1,284 trades · 99.4% positive" />
        <div className="x2f-ex__badges" data-tour="badges">
          <span className="x2f-ex__badge">Trusted</span>
          <span className="x2f-ex__badge">Fast</span>
          <span className="x2f-ex__badge">Security key</span>
          <span className="x2f-ex__badge">+2</span>
        </div>
        <div className="x2f-ex__terms">
          <span className="x2f-ex__price">
            $336.50 <small>Pays in about 10 min</small>
          </span>
          <span className="x2f-ex__pct" data-tour="pct">
            2% <small>above market</small>
          </span>
          <span className="x2f-ex__limits" data-tour="limits">
            <span className="x2f-ex__mono">≈ 0.148588 – 2.971768 XMR</span>
            <span className="x2f-ex__mono">$50 – $1,000 USD</span>
          </span>
        </div>
      </article>
      <article className="x2f-ex__offer">
        <div className="x2f-ex__who">
          <span className="x2f-ex__avatar" aria-hidden="true">
            NO
          </span>
          <span className="x2f-ex__name">
            <span>nightowl_44</span>
            <small>Seen 2 h ago · 58 trades · 97% positive</small>
          </span>
        </div>
        <div className="x2f-ex__terms">
          <span className="x2f-ex__price">
            $333.20 <small>Pays in about 25 min</small>
          </span>
          <span className="x2f-ex__pct">
            1% <small>above market</small>
          </span>
          <span className="x2f-ex__limits">
            <span className="x2f-ex__mono">≈ 0.060024 – 1.200480 XMR</span>
            <span className="x2f-ex__mono">$20 – $400 USD</span>
          </span>
        </div>
      </article>
    </>
  );
}

/** Stop 11: 0.594354 is typed, one character every 90 ms (180 for the first); instant when calm. */
function useTyped(on: boolean, playing: boolean, reduced: boolean): string {
  const [n, setN] = useState(on && (!playing || reduced) ? AMOUNT.length : 0);
  useEffect(() => {
    if (!on) return setN(0);
    if (!playing || reduced) return setN(AMOUNT.length);
    setN(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= AMOUNT.length; i++) timers.push(setTimeout(() => setN(i), 180 + (i - 1) * 90));
    return () => timers.forEach(clearTimeout);
  }, [on, playing, reduced]);
  return AMOUNT.slice(0, n);
}

function Quote({ stop, acted, reduced }: TourStageProps) {
  const typed = useTyped(done(stop, acted, 10), stop === 10, reduced);
  const requested = done(stop, acted, 11);
  const [started, setStarted] = useState(stop > 11);
  useEffect(() => {
    if (!requested) return setStarted(false);
    if (stop > 11 || reduced) return setStarted(true);
    const id = setTimeout(() => setStarted(true), 1300);
    return () => clearTimeout(id);
  }, [requested, stop, reduced]);
  return (
    <>
      <header className="x2f-ex__head">
        <span className="x2f-ex__meta">
          Cash App · USD · $336.50 / XMR · <Example />
        </span>
        <h1 className="x2f-ex__h1">Selling to example_seller</h1>
      </header>
      <section className="x2f-ex__card">
        <Who sub="1,284 trades · 99.4% positive" />
      </section>
      <section aria-label="Amount" data-tour="amount" className="x2f-ex__amount">
        <span className="x2f-ex__cap">You sell</span>
        <span className="x2f-ex__field" data-tour="field" data-focus={stop === 10 && acted ? 'true' : 'false'}>
          <span className="x2f-ex__mono">{typed === '' ? <span className="x2f-ex__ph">0.000000</span> : typed}</span>
          <span>XMR</span>
        </span>
        <span className="x2f-ex__muted">example_seller buys $50 to $1,000 per trade.</span>
      </section>
      <section className="x2f-ex__wash" data-tour="receive">
        <span className="x2f-ex__cap">You receive</span>
        <span className="x2f-ex__big">
          {usd(typed)} <small>USD</small>
        </span>
        <span className="x2f-ex__muted">Paid by example_seller via Cash App</span>
        <dl className="x2f-ex__dl">
          <div>
            <dt>Rate</dt>
            <dd>$336.50 / XMR</dd>
          </div>
          <div>
            <dt>Network fee</dt>
            <dd>Paid by you</dd>
          </div>
          <div>
            <dt>You lock in escrow</dt>
            <dd className="x2f-ex__mono">{typed === '' ? '0.000000' : typed} XMR</dd>
          </div>
        </dl>
      </section>
      <footer className="x2f-ex__foot" data-tour="request">
        <span className="x2f-ex__button" data-tour="request-button" data-state={started ? 'ok' : requested ? 'sent' : 'idle'}>
          {started ? 'Trade started' : requested ? 'Request sent' : 'Request to sell XMR'}
        </span>
        <span className="x2f-ex__muted">{started ? 'example_seller accepted. The trade has started.' : 'Next, you lock the XMR in escrow.'}</span>
      </footer>
    </>
  );
}

function Steps({ at }: { at: number }) {
  return (
    <ol className="x2f-ex__steps" aria-label="Trade progress">
      {['Escrow', 'Buyer pays', 'You check', 'Released'].map((s, i) => (
        <li key={s} data-state={i < at ? 'done' : i === at ? 'current' : 'next'}>
          {s}
        </li>
      ))}
    </ol>
  );
}

function TradeHead() {
  return (
    <header className="x2f-ex__head">
      <span className="x2f-ex__meta">
        Trade K7M2-9QXA-4FTR-8WPN · Cash App · <Example />
      </span>
      <h1 className="x2f-ex__h1">Selling to example_seller</h1>
    </header>
  );
}

function Fund({ stop, acted }: TourStageProps) {
  const locked = done(stop, acted, 13);
  const scanning = stop === 12 && acted;
  return (
    <>
      <TradeHead />
      <div className="x2f-ex__deal">
        <b>0.594354 XMR</b> <small>for $200.00</small> · <b>$336.50 / XMR</b> <small>2% above market</small>
      </div>
      <Steps at={locked ? 1 : 0} />
      <section className="x2f-ex__wash" data-tour="status" data-tint={locked ? 'escrow' : 'caution'} aria-label="Escrow confirmations">
        {locked ? (
          <div className="x2f-ex__swap" key="locked">
            <span className="x2f-ex__status">Locked in escrow</span>
            <span className="x2f-ex__big">
              0.594354 <small>XMR</small>
            </span>
            {/* The Fund screen's own line (escrowCopy.ts). */}
            <span className="x2f-ex__muted">3 keys, any 2 release it. {ONE_KEY_ALONE}</span>
            <h2 className="x2f-ex__h2">example_seller has been told to pay you.</h2>
            <p className="x2f-ex__muted">$200.00 by Cash App, within 30 min.</p>
          </div>
        ) : (
          <div className="x2f-ex__swap" key="waiting">
            <span className="x2f-ex__status">Waiting for you to fund</span>
            <span className="x2f-ex__big">
              29 <small>min</small> 42 <small>s</small>
            </span>
            <span className="x2f-ex__muted">You have 30 min to fund. If it runs out, the trade is cancelled.</span>
            <h2 className="x2f-ex__h2">Trade started with example_seller. Fund the escrow to lock the trade.</h2>
            <p className="x2f-ex__muted">Once funded, neither of you can take the XMR alone.</p>
          </div>
        )}
      </section>
      <section className="x2f-ex__card">
        <h2 className="x2f-ex__h2">Send from your wallet</h2>
        <p className="x2f-ex__muted">Open Send in any Monero wallet and scan this code. It fills in the escrow address and the exact amount.</p>
        <div data-tour="qr" className="x2f-ex__qrwrap">
          <div className="x2f-ex__qr" aria-hidden="true">
            {scanning ? <i className="x2f-ex__scan" /> : null}
          </div>
          <dl className="x2f-ex__dl">
            <div>
              <dt>Escrow address</dt>
              <dd className="x2f-ex__mono x2f-ex__addr">47tRm jJhGD Xcc7i LNpvm 2hqpw F4CiS …</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd className="x2f-ex__mono">0.594354 XMR</dd>
            </div>
          </dl>
        </div>
        <p className="x2f-ex__muted">Send exactly this amount. Your wallet adds the network fee on top.</p>
      </section>
    </>
  );
}

/**
 * The trade room's chat (owner, 16 Nov 2026, demo note #100: "the actual trading window where there
 * is an open chat and it lists the two members in the chat and maybe show some communication back and
 * forth between them"). The pretend trade's own chat, drawn here: the tour never opens a real trade.
 */
export const ROOM_NOTICE = 'Chats are encrypted. If a dispute is opened, a moderator can read this conversation.';
export const ROOM_LINES = [
  { from: 'them', who: 'example_seller', at: '14:12', text: 'Hi. I see the escrow is locked. Sending $200.00 by Cash App now, with K7M2 in the note.' },
  { from: 'me', who: 'You', at: '14:13', text: "Thanks. I'll check my Cash App and release as soon as it's there." },
  { from: 'them', who: 'example_seller', at: '14:16', text: "Sent. Tapping I've paid." },
] as const;

/** Stop 16: the reply and the answer come in one by one (700 ms apart); all at once when calm. */
function useLines(stop: number, acted: boolean, reduced: boolean): number {
  const all = ROOM_LINES.length;
  const playing = stop === STOP.chat && acted;
  const [n, setN] = useState(stop > STOP.chat ? all : 1);
  useEffect(() => {
    if (stop > STOP.chat) return setN(all);
    if (!playing) return setN(1);
    if (reduced) return setN(all);
    const timers = [setTimeout(() => setN(2), 200), setTimeout(() => setN(3), 900)];
    return () => timers.forEach(clearTimeout);
  }, [stop, playing, reduced, all]);
  return n;
}

function TradeRoom({ stop, acted, reduced }: TourStageProps) {
  const shown = useLines(stop, acted, reduced);
  return (
    <>
      <TradeHead />
      <Steps at={1} />
      <section className="x2f-ex__card x2f-ex__members" data-tour="members" aria-label="In this chat">
        <h2 className="x2f-ex__cap">In this chat</h2>
        <ul className="x2f-ex__people">
          <li className="x2f-ex__person">
            <span className="x2f-ex__avatar" aria-hidden="true">
              YO
            </span>
            <span className="x2f-ex__name">
              <span>You</span>
              <small>Seller</small>
            </span>
          </li>
          <li className="x2f-ex__person">
            <span className="x2f-ex__avatar" data-online="true" aria-hidden="true">
              SG
            </span>
            <span className="x2f-ex__name">
              <span>
                example_seller <span className="x2f-ex__vendor">Vendor</span>
              </span>
              <small>Buyer · online</small>
            </span>
          </li>
        </ul>
      </section>
      <section className="x2f-ex__chat" data-tour="chat" aria-label="Chat with example_seller">
        <p className="x2f-ex__notice">{ROOM_NOTICE}</p>
        <ol className="x2f-ex__lines" aria-label="Messages">
          {ROOM_LINES.slice(0, shown).map((l) => (
            <li key={l.at} className="x2f-ex__line x2f-ex__swap" data-from={l.from}>
              <span className="x2f-ex__by">
                {l.who} <small>{l.at}</small>
              </span>
              <span className="x2f-ex__bubble">{l.text}</span>
            </li>
          ))}
        </ol>
        <div className="x2f-ex__compose" aria-hidden="true">
          <span className="x2f-ex__input">Message example_seller</span>
          <span className="x2f-ex__send">Send</span>
        </div>
      </section>
    </>
  );
}

function Check({ stop, acted, reduced }: TourStageProps) {
  const paid = done(stop, acted, STOP.paid);
  const holding = stop === STOP.release && acted;
  const [released, setReleased] = useState(stop > STOP.release);
  useEffect(() => {
    if (!holding) return setReleased(stop > STOP.release);
    const id = setTimeout(() => setReleased(true), 1500);
    return () => clearTimeout(id);
  }, [holding, stop, reduced]);
  return (
    <>
      <TradeHead />
      <Steps at={paid ? 2 : 1} />
      <section className="x2f-ex__wash" data-tour="paid" data-tint={paid ? 'caution' : 'escrow'}>
        {paid ? (
          <div className="x2f-ex__swap" key="paid">
            <span className="x2f-ex__status">Payment sent</span>
            <h2 className="x2f-ex__h2">example_seller marked this trade paid.</h2>
            <p className="x2f-ex__muted">Check your Cash App for $200.00 from example_seller.</p>
          </div>
        ) : (
          <div className="x2f-ex__swap" key="waiting">
            <span className="x2f-ex__status">Locked in escrow</span>
            <h2 className="x2f-ex__h2">Waiting for example_seller to pay</h2>
            <p className="x2f-ex__muted">$200.00 by Cash App. You'll get an alert when they tap I've paid.</p>
          </div>
        )}
      </section>
      <section className="x2f-ex__danger">
        <h2 className="x2f-ex__h2">Screenshots can be faked, even a copy of X2F's own screen.</h2>
        <p>Only your Cash App shows whether the money arrived.</p>
        <span className="x2f-ex__tick" data-tour="tick" data-on={paid ? 'true' : 'false'}>
          <span className="x2f-ex__box" aria-hidden="true">
            {paid ? <Icon name="check" size={16} /> : null}
          </span>
          <span>I checked my Cash App myself and the $200.00 is there.</span>
        </span>
      </section>
      <footer className="x2f-ex__foot" data-tour="release">
        <span className="x2f-ex__hold" data-ready={paid ? 'true' : 'false'} data-holding={holding && !released ? 'true' : 'false'} data-done={released ? 'true' : 'false'}>
          <i className="x2f-ex__fill" aria-hidden="true" />
          <span>{released ? 'Released 0.594354 XMR to example_seller' : holding ? 'Keep holding…' : 'Hold to release 0.594354 XMR'}</span>
        </span>
        {/* Check and release's own line (escrowCopy.ts). */}
        <span className="x2f-ex__muted">{RELEASE_IS_FINAL}</span>
      </footer>
    </>
  );
}

function Released() {
  return (
    <>
      <TradeHead />
      <section className="x2f-ex__wash" data-tint="escrow">
        <span className="x2f-ex__status">Released</span>
        <span className="x2f-ex__big">
          $200.00 <small>USD</small>
        </span>
        <span className="x2f-ex__muted">received by Cash App. 0.594354 XMR released to example_seller.</span>
      </section>
      <section className="x2f-ex__card">
        <Who sub="Buyer · 1,284 trades" />
        <h2 className="x2f-ex__h2">How was trading with example_seller?</h2>
        <span className="x2f-ex__stars" aria-hidden="true">
          ☆☆☆☆☆
        </span>
        <span className="x2f-ex__muted">Your review shows on example_seller's profile straight away.</span>
      </section>
    </>
  );
}

const SCREEN_VIEWS = [FindATrade, Offers, Quote, Fund, TradeRoom, Check, Released] as const;

export function FirstTradeStage(props: TourStageProps) {
  const screen = screenOf(props.stop);
  const View = SCREEN_VIEWS[screen]!;
  return (
    <div className="x2f-ex__screen" key={screen} data-screen-index={screen}>
      <div className="x2f-ex__scroll" data-tour-scroll="">
        <div className="x2f-ex__col">
          <View {...props} />
        </div>
      </div>
    </div>
  );
}
