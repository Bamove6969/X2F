// =============================================================================================
// TRIPWIRE / TODO(Task 30 merge): THIS FILE IS A TEMPORARY STUB.
//
// The real confirm-it's-you UI, `ConfirmSheet({ action })`, is built in Task 30 (a different
// branch) at `apps/web/src/screens/auth/ConfirmSheet.tsx`. It is the only UI for Plan 2's
// action-bound confirm (X-4) and supplies the `prove` callback for auth-client's `withConfirm`.
//
// At merge, when Task 30 has landed:
//   1. delete this file,
//   2. in Wallets.tsx replace `useConfirmSheet` with the real ConfirmSheet wired through
//      auth-client's `withConfirm(walletAction(address), run, prove)` (so the confirm token is
//      bound to the address's hash, spec 6.4 / R17 — this stub does NOT compute that hash),
//   3. the tripwire test in `apps/web/e2e/wallets.spec.ts` fails until step 1 is done.
//
// This stub is good enough for Task 29's own flow: the first wallet in the no-wallet path needs no
// confirm at all, so the add succeeds without ever opening this sheet.
// =============================================================================================
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button.js';
import { Sheet } from '../ui/Sheet.js';

/** The slice of Plan 2's `ConfirmAction` this screen needs; Task 30 passes the full action. */
export interface AddWalletAction {
  kind: 'add-wallet';
  addressEnd: string;
}

/**
 * Stand-in for Task 30's `ConfirmSheet({ action })`. The real sheet offers the account's login
 * methods (PGP, passkey, security key, password + 2FA) and returns a confirm token. This stub only
 * carries the action through and resolves a placeholder token, so the add flow is wired end to end.
 */
export function ConfirmSheet({
  action,
  onToken,
  onCancel,
}: {
  action: AddWalletAction;
  onToken: (token: string) => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open title="Confirm it's you" onClose={onCancel}>
      <p className="x2f-sheet__body">
        Saving a payout wallet ending {action.addressEnd} asks you to confirm it's you, so a hijacked
        session cannot change where your coins go.
      </p>
      {/* TODO(Task 30): the real sheet proves with a login method; this stub returns a placeholder. */}
      <Button variant="primary" onClick={() => onToken('stub-confirm-token')}>
        Confirm
      </Button>
    </Sheet>
  );
}

/**
 * Bridges the sheet to a promise: `prove(action)` opens the sheet and resolves with the token the
 * person produces, or rejects if they dismiss it. `element` is rendered by the screen.
 */
export function useConfirmSheet(): { prove: (action: AddWalletAction) => Promise<string>; element: ReactNode } {
  const [action, setAction] = useState<AddWalletAction | null>(null);
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: unknown) => void } | null>(null);

  const settle = useCallback((token: string | null) => {
    const p = pending.current;
    pending.current = null;
    setAction(null);
    if (!p) return;
    if (token === null) p.reject(new Error('confirm-cancelled'));
    else p.resolve(token);
  }, []);

  const prove = useCallback((next: AddWalletAction) => {
    return new Promise<string>((resolve, reject) => {
      pending.current = { resolve, reject };
      setAction(next);
    });
  }, []);

  const element = action ? (
    <ConfirmSheet action={action} onToken={(t) => settle(t)} onCancel={() => settle(null)} />
  ) : null;

  return { prove, element };
}
