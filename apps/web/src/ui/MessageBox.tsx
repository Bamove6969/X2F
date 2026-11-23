import type { HTMLAttributes, KeyboardEvent } from 'react';

/**
 * A box of text to copy out whole, such as an encrypted PGP login message (owner demo note #98,
 * 16 Nov 2026: "When I click in the box with the pgp message to copy and I do a ctrl-a it should
 * limit the highlighting of text to only that in the message box"). The box takes focus on a click
 * or Tab, and Ctrl-A (Cmd-A on a Mac) inside it selects only its own text, not the whole page.
 * The screens keep their Copy button beside it.
 */
export function selectAllInside(e: KeyboardEvent<HTMLElement>): void {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'a') return;
  e.preventDefault();
  const selection = window.getSelection();
  if (selection === null) return;
  selection.selectAllChildren(e.currentTarget);
}

/** A `<pre class="x2f-pre">` that can be focused and whose Ctrl-A / Cmd-A stays inside it. */
export function MessageBox({ className, children, ...rest }: HTMLAttributes<HTMLPreElement>) {
  return (
    // A focusable, read-only text box (it holds no control): Tab or a click focuses it for Ctrl-A.
    <pre {...rest} className={className === undefined ? 'x2f-pre' : `x2f-pre ${className}`} tabIndex={0} onKeyDown={selectAllInside}>
      {children}
    </pre>
  );
}
