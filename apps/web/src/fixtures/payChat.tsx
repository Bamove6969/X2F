// Fixture builds only (installFixtures): the BuyerPay and Desktop boards' stand-ins for what is
// not built yet: the seller's payment details ("Zelle to [SELLER ZELLE ID]", no API carries them)
// and Task 20's ChatPanel (the Desktop board's chat column). A production bundle never contains
// this file (test/bundle.test.ts).
import { setPaymentDetailsSource, setTradeChat, type TradeChatProps } from '../screens/trade/paySeams.js';
import { PAY_CHAT, PAY_DETAILS } from './payBoard.js';
import './payChat.css';

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

export function installPayFixtures(): void {
  setPaymentDetailsSource((_code, on) => {
    on(PAY_DETAILS);
    return () => undefined;
  });
  setTradeChat(BoardChat);
}
