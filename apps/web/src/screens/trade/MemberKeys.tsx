/**
 * A team member's trade room, for the step their boxes allow (memberActs.ts): first the account's
 * trade escrow keys are loaded on this device (memberKey.ts, keySync.ts `restoreTrades`, unlocked
 * with the member's own passkey, security key or PGP key: TradeKeys.tsx's Unlocker; never an
 * authenticator code or a recovery code), then the escrow runs here and the lead's own screen for
 * the step is shown, with only the member's actions in it (MemberActsContext).
 *
 * The fund step asks for a `fund-trade` confirm before the funding screen opens; its token goes
 * with `fund-started`, so the screen's own post finds it already recorded. Kit parts only.
 */
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { serverClock as makeServerClock } from '../../api/client.js';
import type { TradeView } from '../../api/trade.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { teamCantDoText, teamCantDoTitle, type CantDoCode } from '../../ui/cantDoCodes.js';
import { escrowClient } from '../../escrow/useEscrow.js';
import { deviceHolds, loadMemberTrade } from '../../escrow/memberKey.js';
import { ApiCallError } from '../../api/client.js';
import { isConfirmAbort } from '../auth/ConfirmSheet.js';
import { Unlocker } from '../settings/TradeKeys.js';
import { defaultTradeKeysDeps, keyErrorWords, type StoredReader, type UnlockOptions } from '../settings/tradeKeys.js';
import { isCantDoCode } from '../../ui/cantDoCodes.js';
import { confirmedEvent, type MemberRoomActs, type MemberStep } from './memberActs.js';
import { MEMBER_ROOM_COPY as C } from './memberCopy.js';
import { integrityFailed, useTradeEscrow } from './seams.js';
import type { TradeScreenProps } from './TradeRoom.js';

type Held = 'checking' | 'yes' | 'no';

/** Whether this device's escrow store holds the trade; `recheck` after a load. */
function useDeviceHolds(code: string): { held: Held; recheck: () => void } {
  const [held, setHeld] = useState<Held>('checking');
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setHeld('checking');
    void deviceHolds(escrowClient(), code).then((h) => live && setHeld(h ? 'yes' : 'no'));
    return () => {
      live = false;
    };
  }, [code, n]);
  return { held, recheck: useCallback(() => setN((x) => x + 1), []) };
}

export interface MemberStepRoomProps {
  code: string;
  view: TradeView;
  refresh(): Promise<void>;
  step: MemberStep;
  member: MemberRoomActs;
  /** The lead's screen for this view (TradeRoom `screenFor`), and the integrity screen. */
  screen: ComponentType<TradeScreenProps> | null;
  integrity: ComponentType<TradeScreenProps> | null;
}

/** Loads the keys if needed, then runs the escrow here and shows the lead's screen for the step. */
export function MemberStepRoom(p: MemberStepRoomProps) {
  const { held, recheck } = useDeviceHolds(p.code);
  if (held === 'checking') return <p className="x2f-note" aria-busy="true" data-part="member-keys-checking">{C.keysChecking}</p>;
  if (held === 'no') return <MemberKeys code={p.code} onLoaded={recheck} />;
  return <MemberEscrowRoom {...p} />;
}

/** The escrow runs on this device now (the trade's record is in its store). */
function MemberEscrowRoom({ code, view, refresh, step, member, screen: Screen, integrity: Integrity }: MemberStepRoomProps) {
  const escrow = useTradeEscrow(code);
  const serverNow = view.serverNow;
  const clock = useMemo(() => makeServerClock(serverNow), [serverNow]);
  const broken = integrityFailed(escrow, view);
  const props: TradeScreenProps = { code, view, escrow, refresh, serverClock: clock, wide: false };
  const fundGate = step === 'fund' && view.state === 'funding' && view.fundStartedAt === null && !broken;
  return (
    <div data-member-step={step}>
      {broken ? (
        Integrity ? <Integrity {...props} /> : <p role="alert">Security check failed. Don't fund this trade.</p>
      ) : fundGate ? (
        <FundGate code={code} refresh={refresh} member={member} />
      ) : Screen ? (
        <Screen {...props} />
      ) : null}
    </div>
  );
}

/** `fund-trade` confirm, then `fund-started` with its token; the funding screen opens after. */
function FundGate({ code, refresh, member }: { code: string; refresh: () => Promise<void>; member: MemberRoomActs }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmedEvent(code, 'fund-trade', 'fund-started', member.prove);
      await refresh();
    } catch (e) {
      if (isConfirmAbort(e)) return;
      if (e instanceof ApiCallError && isCantDoCode(e.code)) return member.refused(e.code);
      setError(C.fundFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="x2f-card x2f-stack" data-part="member-fund">
      <h2 className="x2f-card__title">{C.fundTitle}</h2>
      <p className="x2f-note">{C.fundAbout}</p>
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button variant="primary" disabled={busy} onClick={() => void start()} data-part="member-fund-start">
        {C.fundStart}
      </Button>
    </section>
  );
}

type Loaded = { reader: StoredReader; options: UnlockOptions } | 'none' | 'failed' | 'loading';

/** The member's own reader key, unlocked here, opens the account's trade copies sealed to it. */
export function MemberKeys({ code, onLoaded, deps: given }: { code: string; onLoaded: () => void; deps?: ReturnType<typeof defaultTradeKeysDeps> }) {
  const [deps] = useState(() => given ?? defaultTradeKeysDeps());
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Loaded>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await deps.readerState();
        if (!live) return;
        if (r === 'none' || r === 'hidden') return setState('none');
        setState({ reader: r, options: await deps.unlockMethods() });
      } catch {
        if (live) setState('failed');
      }
    })();
    return () => {
      live = false;
    };
  }, [deps]);

  const step = async (f: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(keyErrorWords(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const body = () => {
    if (state === 'loading') return <p className="x2f-note">{C.keysChecking}</p>;
    if (state === 'failed') return <p className="x2f-error" role="alert">{C.keysFailed}</p>;
    if (state === 'none') return <p className="x2f-note" data-part="member-keys-none">{C.keysNoReader}</p>;
    if (!open) {
      return (
        <Button variant="primary" onClick={() => setOpen(true)} data-part="member-keys-load">
          {C.keysLoad}
        </Button>
      );
    }
    return (
      <Unlocker
        lead={C.keysPick}
        reader={state.reader}
        options={state.options}
        busy={busy}
        deps={deps}
        step={step}
        onUnlocked={async (pair) => {
          setNote(C.keysLoading);
          const r = await loadMemberTrade(escrowClient(), code, pair);
          setNote(null);
          setOpen(false);
          if (r === 'loaded') onLoaded();
          else setError(r === 'not-in-copy' ? C.keysNotInCopy : C.keysFailed);
        }}
        onCancel={() => setOpen(false)}
      />
    );
  };

  return (
    <section className="x2f-card x2f-stack" data-part="member-keys" aria-labelledby="member-keys-h">
      <h2 className="x2f-card__title" id="member-keys-h">
        {C.keysTitle}
      </h2>
      <p className="x2f-note">{C.keysAbout}</p>
      {error !== null ? (
        <p className="x2f-error" role="alert" data-part="member-keys-error">
          {error}
        </p>
      ) : null}
      {note !== null ? (
        <p className="x2f-note" role="status">
          {note}
        </p>
      ) : null}
      {body()}
    </section>
  );
}

/** The team refusal for a member's step (403 `forbidden` and the like): the one CantDoThat. */
export function MemberRefusal({ code, onClose }: { code: CantDoCode; onClose: () => void }) {
  return <CantDoThat title={teamCantDoTitle(code)} body={teamCantDoText(code)} from={code} onClose={onClose} />;
}
