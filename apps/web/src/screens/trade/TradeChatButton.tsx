/**
 * The trade chat's way in (BuyerPay board's "Chat"; Task 20's ChatPanel through the seam): a header
 * link or a primary button that opens the chat sheet, or moves the focus to the room's chat pane
 * when it shows (Task 40). Shared by BuyerPay and the buyer's wait for funding (design proto
 * review P1, 8 Nov: the buyer had no chat there).
 */
import { useEffect, useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { Sheet } from '../../ui/Sheet.js';
import { useTradeChat } from './paySeams.js';
import { publicName, type TradeView } from './payTypes.js';
import { focusChatPane, useChatPane } from './TradeRoom.js';
import './pay.css';

/** The chat for the trade (Task 20's ChatPanel through the seam), or nothing until it is installed. */
export function ChatSlot({ view }: { view: TradeView }) {
  const Chat = useTradeChat();
  return Chat ? <Chat code={view.code} name={publicName(view.counterparty)} /> : null;
}

/** `link` is the paid room's inline "Message … in chat" (board BuyerPaidWaiting). */
export function ChatButton({ view, primary, link }: { view: TradeView; primary?: boolean; link?: boolean }) {
  const [open, setOpen] = useState(false);
  // With the room's chat pane showing (Task 40), the chat is already beside the screen: the sheet
  // closes on unfold (one draft, one composer), and the primary Chat moves the focus there.
  const paned = useChatPane(view);
  useEffect(() => {
    if (!paned || !open) return;
    setOpen(false);
    // The sheet already closed (`open && !paned`) and handed the focus back to the header Chat,
    // hidden now under [data-chat-link]: give it to the pane's composer, which holds the same
    // draft, once the pane is laid out (round-2 review m4).
    requestAnimationFrame(() => focusChatPane());
  }, [paned, open]);
  const onChat = () => (paned ? focusChatPane() : setOpen(true));
  return (
    <>
      {primary ? (
        <Button variant="primary" onClick={onChat}>
          Chat
        </Button>
      ) : link ? (
        <button type="button" className="x2f-inline-action" onClick={onChat} data-part="paid-chat">
          <Icon name="chat" size={20} />
          Message {publicName(view.counterparty)} in chat
        </button>
      ) : (
        <button type="button" className="x2f-room__chat" onClick={onChat} data-chat-link="">
          Chat
        </button>
      )}
      <Sheet open={open && !paned} title={`Chat with ${publicName(view.counterparty)}`} onClose={() => setOpen(false)}>
        <div className="x2f-sheet__body">
          <ChatSlot view={view} />
        </div>
      </Sheet>
    </>
  );
}
