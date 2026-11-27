/**
 * Settings > Account type (owner, 2 Nov 2026; board BecomeVendor): Trader (the default; takes
 * offers, no fee) or Vendor (posts offers, may add team members, pays the 1% fee). The account
 * holder switches to vendor here: it needs a passkey, security key or PGP key on the account, a
 * "Switch to a vendor account?" sheet (it turns on the fee), and a confirm with one of those
 * (the confirm sheet offers no password for `become-vendor`). There is no switching back (owner answer Q77, 6 Nov 2026).
 *
 * Kit parts and existing classes only, no stylesheet of its own. A team member gets the
 * owner-only refusal (OwnerOnly); every API refusal goes through CantDoThat.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AuthApiError, becomeVendorAction, isVendor, withConfirm, type AccountOverview } from '@x2f/auth-client';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat, isCantDoCode, type CantDoCode } from '../../ui/CantDoThat.js';
import { Sheet } from '../../ui/Sheet.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { CANT_DO_TITLE, VENDOR_NEEDS_KEY_CODE, accountTypeCantDoText } from '../../ui/cantDoCodes.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { ACCOUNT_TYPE_COPY as C, ACCOUNT_TYPE_PATH } from './accountTypeCopy.js';
import { OwnerOnly } from './OwnerOnly.js';
import '../screens.css';

/** The vendor requirement as the browser can see it: a passkey, security key or PGP key on the account. */
export function hasVendorKey(me: Pick<AccountOverview, 'methods'>): boolean {
  return me.methods.some((m) => m === 'passkey' || m === 'security-key' || m === 'pgp');
}

function AccountTypeScreen() {
  const { prove, confirmUi, open } = useConfirm();
  const [me, setMe] = useState<AccountOverview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'load-failed' | 'signed-out'>('loading');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cantDo, setCantDo] = useState<CantDoCode | null>(null);
  const [said, setSaid] = useState('');

  const load = useCallback(async () => {
    try {
      setMe(await authApi.me());
      setState('ready');
    } catch (e) {
      setState(e instanceof AuthApiError && e.status === 401 ? 'signed-out' : 'load-failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const vendor = isVendor(me);
  const keyMet = me !== null && hasVendorKey(me);

  const switchNow = async () => {
    if (busy) return;
    setAsking(false);
    setBusy(true);
    setError(null);
    try {
      await withConfirm(becomeVendorAction(), (confirmToken) => authApi.becomeVendor({ confirmToken }), prove);
      setSaid(C.switched);
      refreshSession();
      await load();
    } catch (e) {
      if (isConfirmAbort(e)) return;
      if (e instanceof AuthApiError && isCantDoCode(e.code)) setCantDo(e.code);
      else setError(C.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmOpenProvider value={open}>
      <main className="x2f-screen" data-screen="account-type">
        <h1 className="x2f-screen__title">{C.title}</h1>
        <p className="x2f-note">{C.intro}</p>
        {state === 'signed-out' ? (
          <section className="x2f-card">
            <p className="x2f-note">{C.signedOut}</p>
            <Link className="x2f-button x2f-button--secondary" to={`/login?returnTo=${encodeURIComponent(ACCOUNT_TYPE_PATH)}`}>
              Log in
            </Link>
          </section>
        ) : null}
        {state === 'load-failed' ? (
          <p className="x2f-error" role="alert">
            {C.loadFailed}
          </p>
        ) : null}
        {error !== null ? (
          <p className="x2f-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="x2f-note" role="status" data-part="said">
          {said}
        </p>

        {me !== null ? (
          <>
            <section className="x2f-card" aria-label={C.yourAccount} data-part="current">
              <h2 className="x2f-card__title">{C.yourAccount}</h2>
              <div className="x2f-row">
                <strong data-part="type-name">{C.typeName[vendor ? 'vendor' : 'trader']}</strong>
                <StatusChip tone="escrow" icon="check-circle" label={C.current} />
              </div>
              <p className="x2f-note">{C.typeText[vendor ? 'vendor' : 'trader']}</p>
            </section>

            <section className="x2f-card" aria-label={C.compareTitle} data-part="compare">
              <h2 className="x2f-card__title">{C.compareTitle}</h2>
              <p className="x2f-note">{C.compareCaption}</p>
              <ul className="x2f-list" data-part="compare-rows">
                {C.rows.map((r) => (
                  <li className="x2f-list__row" key={r.what}>
                    <span className="x2f-list__label">{r.what}</span>
                    <span>
                      {C.typeName.trader}: {r.trader} · {C.typeName.vendor}: {r.vendor}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {vendor ? (
              <section className="x2f-card" data-part="vendor">
                <Link className="x2f-button x2f-button--primary" to="/post" state={{ from: ACCOUNT_TYPE_PATH }} data-primary="" data-part="post">
                  {C.postOffer}
                </Link>
                <p className="x2f-note" data-part="no-switch-back">{C.noSwitchBack}</p>
                <p className="x2f-note" data-part="inactive-closes">{C.inactiveCloses}</p>
              </section>
            ) : (
              <section className="x2f-card" aria-label={C.becomeTitle} data-part="become">
                <h2 className="x2f-card__title">{C.becomeTitle}</h2>
                <ul className="x2f-list">
                  <li className="x2f-list__row" data-part="key-req" data-met={keyMet ? 'true' : 'false'}>
                    <div className="x2f-stack">
                      <span className="x2f-list__label">{C.keyReq}</span>
                      <span className="x2f-note">{keyMet ? C.keyMet : C.keyNotMet}</span>
                      {keyMet ? null : (
                        <Link className="x2f-button x2f-button--quiet" to="/settings/security" data-part="add-key">
                          {C.addKey}
                        </Link>
                      )}
                    </div>
                    {/* Literal tones, one chip per case (moderator-badge-scope: no tone from a variable outside the dispute screens). */}
                    {keyMet ? (
                      <StatusChip tone="escrow" icon="check-circle" label={C.met} />
                    ) : (
                      <StatusChip tone="caution" icon="alert" label={C.notMet} />
                    )}
                  </li>
                </ul>
                <Button
                  variant={open ? 'secondary' : 'primary'}
                  disabled={busy}
                  data-part="switch"
                  onClick={() => (keyMet ? setAsking(true) : setCantDo(VENDOR_NEEDS_KEY_CODE))}
                >
                  {C.switchButton}
                </Button>
              </section>
            )}
          </>
        ) : null}

        <Sheet open={asking} title={C.sheetTitle} onClose={() => setAsking(false)}>
          <div className="x2f-stack" data-part="switch-sheet">
            {C.sheetLines.map((l) => (
              <p className="x2f-sheet__body" key={l}>
                {l}
              </p>
            ))}
            <p className="x2f-sheet__body">{C.noSwitchBack}</p>
            <p className="x2f-sheet__body">{C.inactiveCloses}</p>
            <Button variant="primary" onClick={() => void switchNow()} data-part="switch-confirm">
              {C.sheetConfirm}
            </Button>
            <Button variant="quiet" onClick={() => setAsking(false)}>
              {C.cancel}
            </Button>
          </div>
        </Sheet>

        {cantDo !== null ? (
          <CantDoThat title={CANT_DO_TITLE.accountType} body={accountTypeCantDoText(cantDo)} from={cantDo} onClose={() => setCantDo(null)} />
        ) : null}
        {confirmUi}
      </main>
    </ConfirmOpenProvider>
  );
}

export function AccountType() {
  return (
    <OwnerOnly screen="account-type">
      <AccountTypeScreen />
    </OwnerOnly>
  );
}
