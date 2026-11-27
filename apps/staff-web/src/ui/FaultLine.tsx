import { RetryButton } from './kit.js';

const RELOAD = 'Reload';
const RELOAD_TAIL = `${RELOAD} to try again.`;

/**
 * DESIGN: owner 17 Nov black+orange rule, the staff app. A page's load-fault line, word for word, with
 * its retry as the kit's orange text button (apps/web ui/RetryButton.tsx), so a staff page that could
 * not load still shows the brand orange as its way forward: "… Reload to try again." makes "Reload"
 * the button; another load-fault line (`reload`) gets "Reload" after it. A save fault stays plain
 * text (a reload would lose what was typed).
 */
export function FaultLine({ text, reload = text.endsWith(RELOAD_TAIL) }: { text: string; reload?: boolean }) {
  if (!reload) return <>{text}</>;
  if (text.endsWith(RELOAD_TAIL)) {
    return (
      <>
        {text.slice(0, -RELOAD_TAIL.length)}
        <RetryButton data-part="fault-reload">{RELOAD}</RetryButton>
        {RELOAD_TAIL.slice(RELOAD.length)}
      </>
    );
  }
  return (
    <>
      {text} <RetryButton data-part="fault-reload">{RELOAD}</RetryButton>
    </>
  );
}
