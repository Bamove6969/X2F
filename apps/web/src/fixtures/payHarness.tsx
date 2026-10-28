// Task 23's stand-in for Task 22's trade room, in fixture builds only (main.tsx mounts it at
// /__harness/pay/<code>; a production bundle never contains it, apps/web/test/bundle.test.ts).
// Like the room it reads GET /v1/trades/:code (e2e/pay.harness.ts answers it), re-reads on
// refresh(), follows the server clock, wraps wide screens in DesktopShell and picks the screen
// from TASK23_SLOTS. The escrow is a fake that records each action in `window.__x2fPay.calls`;
// `window.__x2fPay.ack()` plays the moderator's trade.ack of trade.paid.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useParams } from 'react-router';
import { api, serverClock } from '../api/client.js';
import { TASK23_SLOTS } from '../screens/trade/BuyerPay.js';
import { setPaidAckSource, setPaymentDetailsSource, setTradeChat, type TradeChatProps } from '../screens/trade/paySeams.js';
import type { TradeEscrow, TradeView } from '../screens/trade/payTypes.js';
import { PENDING_ESCROW } from '../screens/trade/seams.js';
import { DesktopShell } from '../ui/DesktopShell.js';
import { PAY_CHAT, PAY_DETAILS } from './payBoard.js';
import './payHarness.css';

interface PayHarness {
  calls: string[];
  ack(): void;
}

declare global {
  interface Window {
    __x2fPay?: PayHarness;
  }
}

const acks = new Set<() => void>();
const harness: PayHarness = {
  calls: [],
  ack: () => {
    for (const a of acks) a();
  },
};

function record(name: string) {
  return async (...a: unknown[]): Promise<void> => {
    harness.calls.push(a.length > 0 ? `${name}(${String(a[0])})` : name);
  };
}

const ESCROW: TradeEscrow = {
  ...PENDING_ESCROW,
  phase: 'ready',
  release: record('release'),
  buildRefund: record('buildRefund'),
  buyerCancel: record('buyerCancel'),
  proposeCancelSign: record('proposeCancelSign'),
  markPaid: record('markPaid'),
  retry: () => undefined,
  signal: record('signal'),
};

/** The Desktop board's chat column, standing in for Task 20's ChatPanel. */
function BoardChat({ name }: TradeChatProps) {
  return (
    <div className="x2f-board-chat">
      <div className="x2f-board-chat__log">
        <span className="x2f-board-chat__notice">{PAY_CHAT.notice}</span>
        {PAY_CHAT.messages.map((m) => (
          <p key={m.text} className="x2f-board-chat__msg" data-from={m.from}>
            {m.text}
          </p>
        ))}
      </div>
      <div className="x2f-board-chat__compose">
        <label htmlFor="msg" className="x2f-board-chat__label">
          Message
        </label>
        <input id="msg" type="text" placeholder={`Message ${name}`} className="x2f-board-chat__input" />
        <button type="button" aria-label={`Nudge ${name} with a sound`} className="x2f-board-chat__nudge">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 003.4 0" />
          </svg>
        </button>
        <button type="button" className="x2f-board-chat__send">
          Send
        </button>
      </div>
    </div>
  );
}

const WIDE = '(min-width: 1024px)';
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const q = window.matchMedia(WIDE);
      q.addEventListener('change', onChange);
      return () => q.removeEventListener('change', onChange);
    },
    () => window.matchMedia(WIDE).matches,
  );
}

export function PayHarness() {
  const { code = '' } = useParams();
  const [view, setView] = useState<TradeView | null>(null);
  const wide = useWide();
  const refresh = useCallback(async () => {
    setView(await api<TradeView>(`/v1/trades/${encodeURIComponent(code)}`));
  }, [code]);
  useEffect(() => {
    window.__x2fPay = harness;
    setPaymentDetailsSource((_c, on) => {
      on(PAY_DETAILS);
      return () => undefined;
    });
    setTradeChat(BoardChat);
    setPaidAckSource((_c, on) => {
      acks.add(on);
      return () => acks.delete(on);
    });
    void refresh();
  }, [refresh]);
  const clock = useMemo(() => (view ? serverClock(view.serverNow) : () => new Date()), [view?.serverNow]);
  if (!view) return <main data-screen="trade" aria-busy="true" />;
  const slot = TASK23_SLOTS.find((s) => s.role === view.role && s.states.includes(view.state));
  const Screen = slot?.screen;
  const room = (
    <main data-screen="trade" data-trade-state={view.state} data-role={view.role}>
      {Screen ? <Screen view={view} escrow={ESCROW} refresh={refresh} serverClock={clock} wide={wide} /> : <p>State: {view.state}</p>}
    </main>
  );
  return wide ? <DesktopShell>{room}</DesktopShell> : <div data-shell="phone">{room}</div>;
}
