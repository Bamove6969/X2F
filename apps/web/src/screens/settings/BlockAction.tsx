/**
 * "Block <name>" (Plan 3 Task 37), wherever a trader is shown to a signed-in trader: the quote
 * and Task 20's ChatPanel (under its notice) today; Plan 5's profile when it lands. Asks once (Claude Design's Block
 * board: what the block does, that it is silent, that open trades finish), then blocks. A block
 * the API refuses (400 yourself, 404 a closed account) opens CantDoThat (Plan 5 Task 21) with its
 * feedback link; a failure (network, server) stays inline. Kit parts only. The question is the
 * Block board's confirm sheet (design review 1 Nov, shot 64): the kit Sheet with the title
 * "Block <name>?", the list, the silent and open-trades lines, then a 56px outlined danger
 * "Block <name>" and Cancel as separate full-width buttons (never run together).
 * Focus (review M2): opening moves it to the question, Cancel returns it to "Block <name>", and the
 * outcome is announced (role="status") and focused. Nothing is shown to the person being blocked.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { Sheet } from '../../ui/Sheet.js';
import { CANNOT_BLOCK, CANNOT_BLOCK_CODE, CANT_DO_TITLE } from '../../ui/cantDoCodes.js';
import { blockTrader } from './blockApi.js';
import { BLOCK_COPY as C } from './blockCopy.js';

export const BLOCKED_PATH = '/settings/blocked';

type State = { kind: 'idle' } | { kind: 'asking' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'refused' } | { kind: 'error'; text: string };

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
      const refused = e instanceof ApiCallError && (e.status === 404 || e.status === 400);
      // A refusal: the popup takes focus itself, and closing it returns focus to "Block <name>".
      if (refused) go({ kind: 'refused' }, null);
      else go({ kind: 'error', text: C.failed(displayName) }, 'open');
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
  const asking = state.kind === 'asking' || state.kind === 'busy';
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
      {/* Review I1: while the block is in flight the sheet stays (no Esc, close or backdrop), so it never looks cancelled and then lands. */}
      <Sheet
        open={asking}
        title={C.confirmTitle(displayName)}
        initialFocus="#block-ask-h"
        onClose={() => {
          if (state.kind !== 'busy') go({ kind: 'idle' }, 'open');
        }}
      >
        <div className="x2f-sheet__content" data-part="block-ask">
          <div className="x2f-stack">
            <p className="x2f-sheet__body" id="block-ask-h" tabIndex={-1} ref={ask}>
              {C.confirmLead(displayName)}
            </p>
            <ul className="x2f-sheet__list">
              {C.cant.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <p className="x2f-sheet__body">{C.silent}</p>
          <p className="x2f-callout">{C.openTrades}</p>
          <p className="x2f-fine">{C.later}</p>
          <div className="x2f-sheet__actions">
            <Button variant="danger-outline" disabled={state.kind === 'busy'} onClick={() => void block()} data-part="block-confirm">
              {C.action(displayName)}
            </Button>
            <Button variant="quiet" disabled={state.kind === 'busy'} onClick={() => go({ kind: 'idle' }, 'open')}>
              {C.cancel}
            </Button>
          </div>
        </div>
      </Sheet>
      <CantDoThat
        open={state.kind === 'refused'}
        title={CANT_DO_TITLE.block}
        body={CANNOT_BLOCK}
        from={CANNOT_BLOCK_CODE}
        onClose={() => go({ kind: 'idle' }, 'open')}
      />
    </div>
  );
}
