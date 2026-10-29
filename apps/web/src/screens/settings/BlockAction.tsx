/**
 * "Block <name>" (Plan 3 Task 37), wherever a trader is shown to a signed-in trader: the quote
 * today; Plan 5's profile and Task 20's chat when they land. Asks once, then blocks; refusals are
 * shown inline (Plan 5 Task 21's CantDoThat popup is not on the main line yet). Kit parts only
 * (Button, x2f-note, x2f-error): Claude Design has no board for it yet (brief item 14; tripwire
 * NEEDS_DESIGN_BLOCK). Nothing is shown to the person being blocked.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { blockTrader } from './blockApi.js';
import { BLOCK_COPY as C } from './blockCopy.js';

export const BLOCKED_PATH = '/settings/blocked';

type State = { kind: 'idle' } | { kind: 'asking' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; text: string };

export function BlockAction({ displayName, onBlocked }: { displayName: string; onBlocked?: () => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const block = async () => {
    setState({ kind: 'busy' });
    try {
      await blockTrader(displayName);
      setState({ kind: 'done' });
      onBlocked?.();
    } catch (e) {
      const cannot = e instanceof ApiCallError && (e.status === 404 || e.status === 400);
      setState({ kind: 'error', text: cannot ? C.cannot : C.failed(displayName) });
    }
  };

  if (state.kind === 'done') {
    return (
      <div data-part="block-done">
        <p className="x2f-note" role="status">
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
        <p className="x2f-sheet__body" id="block-ask-h">
          <strong>{C.confirmTitle(displayName)}</strong> {C.confirmBody}
        </p>
        <Button variant="danger" disabled={state.kind === 'busy'} onClick={() => void block()} data-part="block-confirm">
          {C.confirm}
        </Button>
        <Button variant="quiet" disabled={state.kind === 'busy'} onClick={() => setState({ kind: 'idle' })}>
          {C.cancel}
        </Button>
      </div>
    );
  }
  return (
    <div data-part="block">
      {state.kind === 'error' ? (
        <p className="x2f-error" role="alert">
          {state.text}
        </p>
      ) : null}
      <Button variant="quiet" onClick={() => setState({ kind: 'asking' })} data-part="block-open">
        {C.action(displayName)}
      </Button>
    </div>
  );
}
