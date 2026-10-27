import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { ApiCallError, safeReturnTo } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import { suggestMethod } from './api.js';
import './browse.css';

// "Suggest a missing method" (P3-M3), opened from the Main board's empty-search copy. The API stores
// the name with no account (Task 3); it needs a signed-in trader.
type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; name: string } | { kind: 'signed-out' } | { kind: 'failed' };

const NAME_MAX = 60;

export function SuggestMethodSheet({ open, initialName, onClose }: { open: boolean; initialName: string; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const inputId = useId();
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (open) {
      setName(initialName);
      setState({ kind: 'idle' });
    }
  }, [open, initialName]);

  const clean = name.trim();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (clean === '' || state.kind === 'sending') return;
    setState({ kind: 'sending' });
    try {
      await suggestMethod(clean);
      setState({ kind: 'sent', name: clean });
    } catch (err) {
      setState(err instanceof ApiCallError && err.status === 401 ? { kind: 'signed-out' } : { kind: 'failed' });
    }
  };

  return (
    <Sheet open={open} title="Suggest a payment method" onClose={onClose}>
      {state.kind === 'sent' ? (
        <p className="x2f-browse__note" role="status">
          Thanks. We will look at adding {state.name}. Until then, you can post an offer with a custom payment method.
        </p>
      ) : (
        <form className="x2f-suggest" onSubmit={(e) => void submit(e)}>
          <label htmlFor={inputId} className="x2f-suggest__label">
            Payment method name
          </label>
          <input
            id={inputId}
            className="x2f-input"
            type="text"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
          {state.kind === 'signed-out' ? (
            <p className="x2f-browse__note" role="alert">
              <Link className="x2f-link" to={`/login?returnTo=${encodeURIComponent(safeReturnTo(pathname + search))}`}>
                Log in
              </Link>{' '}
              to suggest a payment method.
            </p>
          ) : null}
          {state.kind === 'failed' ? (
            <p className="x2f-browse__note" role="alert">
              That did not send. Try again in a moment.
            </p>
          ) : null}
          <Button variant="secondary" type="submit" disabled={clean === '' || state.kind === 'sending'}>
            Send suggestion
          </Button>
        </form>
      )}
    </Sheet>
  );
}
