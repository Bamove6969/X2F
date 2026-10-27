import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { LiveEvent } from '../api/events.js';
import { Button } from '../ui/Button.js';
import { Sheet } from '../ui/Sheet.js';
import { StatusChip } from '../ui/StatusChip.js';
import './accepted.css';

/** The fields of a `GET /v1/wallets` entry (Plan 2) this sheet shows; the full address is never shown here. */
export interface AcceptedWallet {
  id: string;
  app: string;
  label: string;
  addressEnd: string;
  usable: boolean;
}

/** The poster's wallets, as `GET /v1/wallets` lists them. */
export async function loadPosterWallets(): Promise<AcceptedWallet[]> {
  return api<AcceptedWallet[]>('/v1/wallets');
}

/**
 * SEAM(Task 5): `POST /v1/trades/:code/wallet { walletId }` (poster only, in `setup`, once) is
 * built by Task 5, not yet merged. This is the only call site; Task 5's tests own the route, and
 * Task 23 (trade room) checks the room moves to "Setting up escrow" end to end
 * (apps/web/e2e/accepted.spec.ts lands with it).
 */
export async function postTradeWallet(code: string, walletId: string): Promise<void> {
  await api(`/v1/trades/${encodeURIComponent(code)}/wallet`, { method: 'POST', body: { walletId } });
}

type Phase = 'loading' | 'pick' | 'sending' | 'done';

/**
 * Shown to an offer's poster on a live `accepted` event: "<display name> accepted your offer".
 * The poster picks which of their usable wallets this trade uses (spec 2.2 step 4; no default
 * wallet, OD-11); escrow setup starts after that, and the trade waits in `setup` until `setupBy`.
 * A poster with no usable wallet gets Add a wallet, which comes back to this trade.
 */
export function AcceptedSheet({
  event,
  onDone,
  onClose,
  loadWallets = loadPosterWallets,
  submit = postTradeWallet,
}: {
  event: Extract<LiveEvent, { type: 'accepted' }>;
  onDone: (code: string) => void;
  onClose: () => void;
  loadWallets?: () => Promise<AcceptedWallet[]>;
  submit?: (code: string, walletId: string) => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [wallets, setWallets] = useState<AcceptedWallet[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Loaded once per sheet (a caller's inline loader must not reload, and reset the pick, on every render).
  const load = useRef(loadWallets);

  useEffect(() => {
    let live = true;
    load.current().then(
      (all) => {
        if (!live) return;
        // No wallet is pre-selected (OD-11, X-2: no default payout wallet; always ask). The
        // button stays disabled until the poster picks one.
        setWallets(all.filter((w) => w.usable));
        setPhase('pick');
      },
      () => {
        if (!live) return;
        setFailed(true);
        setPhase('pick');
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const use = async () => {
    if (!picked) return;
    setFailed(false);
    setPhase('sending');
    try {
      await submit(event.code, picked);
    } catch {
      setFailed(true);
      setPhase('pick');
      return;
    }
    setPhase('done');
    onDone(event.code);
  };

  const returnTo = encodeURIComponent(`/trade/${event.code}`);

  return (
    <Sheet open title={`${event.by} accepted your offer`} onClose={onClose}>
      {phase === 'done' ? (
        <StatusChip tone="escrow" icon="shield" label="Setting up escrow" />
      ) : phase === 'loading' ? null : wallets.length === 0 && !failed ? (
        <>
          <p className="x2f-sheet__body">You have no wallet ready for this trade. Add one to start.</p>
          <Button variant="primary" href={`/wallets?add=1&returnTo=${returnTo}`}>
            Add a wallet
          </Button>
        </>
      ) : (
        <>
          <p className="x2f-sheet__body">Pick the wallet for this trade. Escrow setup starts after that.</p>
          <fieldset className="x2f-accepted__wallets">
            <legend className="x2f-accepted__legend">Your wallets</legend>
            {wallets.map((w) => (
              <label key={w.id} className="x2f-accepted__wallet">
                <input
                  type="radio"
                  name="accepted-wallet"
                  value={w.id}
                  checked={picked === w.id}
                  onChange={() => setPicked(w.id)}
                />
                <span className="x2f-accepted__label">{w.label}</span>
                <span className="x2f-accepted__end">…{w.addressEnd}</span>
              </label>
            ))}
          </fieldset>
          {failed ? (
            <p role="alert" className="x2f-accepted__error">
              That did not work. Try again.
            </p>
          ) : null}
          <Button variant="primary" disabled={!picked || phase === 'sending'} onClick={() => void use()}>
            Use this wallet
          </Button>
        </>
      )}
    </Sheet>
  );
}
