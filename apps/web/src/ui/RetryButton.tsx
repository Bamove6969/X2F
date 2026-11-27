import './ui.css';

// DESIGN: owner 17 Nov black+orange rule. The retry on a screen's load-error line, in the kit's
// orange text-button style (ui.css .x2f-text-button), so a screen that could not load still shows
// the brand orange as its one way forward. Without `onClick` it reloads the page, as the screens'
// own "Reload the page to try again" lines say.
export function RetryButton({ children = 'Try again', onClick, ...data }: { children?: string; onClick?: () => void; [k: `data-${string}`]: string | undefined }) {
  return (
    <button type="button" className="x2f-text-button" onClick={onClick ?? (() => window.location.reload())} {...data}>
      {children}
    </button>
  );
}

const RELOAD = 'Reload the page';
const RELOAD_TAIL = `${RELOAD} to try again.`;

/**
 * A load-error line, word for word, with its retry as the orange text button: "… Reload the page to
 * try again." makes "Reload the page" the button (as the Terms' stale line does), "… Try again."
 * makes "Try again" the button; any other line gets "Try again" after it.
 */
export function RetryLine({ text, ...data }: { text: string; [k: `data-${string}`]: string | undefined }) {
  if (text.endsWith(RELOAD_TAIL)) {
    return (
      <>
        {text.slice(0, -RELOAD_TAIL.length)}
        <RetryButton {...data}>{RELOAD}</RetryButton>
        {RELOAD_TAIL.slice(RELOAD.length)}
      </>
    );
  }
  if (text.endsWith(' Try again.')) {
    return (
      <>
        {text.slice(0, -'Try again.'.length)}
        <RetryButton {...data} />.
      </>
    );
  }
  return (
    <>
      {text} <RetryButton {...data} />
    </>
  );
}
