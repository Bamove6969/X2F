/**
 * "Block <name>" (Plan 3 Task 37), wherever a trader is shown to a signed-in trader: the quote
 * today; Plan 5's profile and Task 20's chat when they land. Asks once (Claude Design's Block
 * board: what the block does, that it is silent, that open trades finish), then blocks; refusals
 * are inline (Plan 5 Task 21's CantDoThat popup is not on the main line yet). Kit parts only.
 * Focus (review M2): opening moves it to the question, Cancel returns it to "Block <name>", and the
 * outcome is announced (role="status") and focused. Nothing is shown to the person being blocked.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { blockTrader } from './blockApi.js';
import { BLOCK_COPY as C } from './blockCopy.js';

export const BLOCKED_PATH = '/settings/blocked';

type State = { kind: 'idle' } | { kind: 'asking' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; text: string };

export function BlockAction({ displayName, onBlocked }: { displayName: string; onBlocked?: () => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const ask = useRef<HTMLParagraphElement>(null);
  const open = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLParagraphElement>(null);
  // Where focus goes after the next render: set by the step that changes the view.
  const focusNext = useRef<'ask' | 'open' | 'done' | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'ask') ask.current?.focus();
    if (target === 'done') done.current?.focus();
    if (target === 'open') open.current?.querySelector('button')?.focus();
  });

  const go = (next: State, focus: 'ask' | 'open' | 'done' | null) => {
    focusNext.current = focus;
    setState(next);
  };

  const block = async () => {
    setState({ kind: 'busy' });
    try {
      await blockTrader(displayName);
      go({ kind: 'done' }, 'done');
      onBlocked?.();
    } catch (e) {
      const cannot = e instanceof ApiCallError && (e.status === 404 || e.status === 400);
      go({ kind: 'error', text: cannot ? C.cannot : C.failed(displayName) }, 'open');
    }
  };

  if (state.kind === 'done') {
    return (
      <div data-part="block-done">
        <p className="x2f-note" role="status" tabIndex={-1} ref={done}>
          {C.done(displayName)}
        </p>
        {/* The kit's quiet button look on a router link (no new CSS). */}
        <Link className="x2f-button x2f-button--quiet" to={BLOCKED_PATH}>
          {C.manage}
        </Link>
      </div>
    );
  }
  if (state.kind === 'asking' || state.kind === 'busy') {
    return (
      <div role="group" aria-labelledby="block-ask-h" data-part="block-ask">
        <p className="x2f-sheet__body" id="block-ask-h" tabIndex={-1} ref={ask}>
          <strong>{C.confirmTitle(displayName)}</strong>
        </p>
        <p className="x2f-sheet__body">{C.confirmLead(displayName)}</p>
        <ul className="x2f-sheet__body">
          {C.cant.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="x2f-sheet__body">{C.silent}</p>
        <p className="x2f-sheet__body">{C.openTrades}</p>
        <p className="x2f-note">{C.later}</p>
        <Button variant="danger" disabled={state.kind === 'busy'} onClick={() => void block()} data-part="block-confirm">
          {C.action(displayName)}
        </Button>
        <Button variant="quiet" disabled={state.kind === 'busy'} onClick={() => go({ kind: 'idle' }, 'open')}>
          {C.cancel}
        </Button>
      </div>
    );
  }
  return (
    <div data-part="block" ref={open}>
      {state.kind === 'error' ? (
        <p className="x2f-error" role="alert">
          {state.text}
        </p>
      ) : null}
      <Button variant="quiet" onClick={() => go({ kind: 'asking' }, 'ask')} data-part="block-open">
        {C.action(displayName)}
      </Button>
    </div>
  );
}
