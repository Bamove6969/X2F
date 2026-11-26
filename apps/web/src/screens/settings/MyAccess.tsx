/**
 * A team member's own access, read only (`GET /v1/team/me`): who their team lead is, the boxes they
 * hold in the catalogue's own words (grouped as the catalogue groups them), their trade-size band and
 * working hours, and whether they are inside those hours now. Shown to a member on Settings →
 * Security (where a member lands: they have no Account tab) and on the Team screen (which is the
 * owner's and refuses them). Nothing here can be changed: the lead sets it all.
 *
 * For the account owner the API answers 403 and the card shows nothing. No Claude Design board yet
 * (NEEDS_DESIGN_TEAM in test/team-tripwires.test.ts): kit parts and existing classes only.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AuthApiError, type MyTeamAccess } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { When } from '../../ui/When.js';
import { authApi } from '../auth/authApi.js';
import { MY_ACCESS_COPY as C, bandText, hoursText } from './teamCopy.js';
import { TEAM_LOG_COPY, TEAM_LOG_PATH } from './teamLogCopy.js';

type State = { kind: 'loading' } | { kind: 'ready'; view: MyTeamAccess } | { kind: 'none' } | { kind: 'failed' };

export function MyAccess() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    authApi.myTeamAccess().then(
      (view) => setState({ kind: 'ready', view }),
      // The account owner (403), a signed-out session (401) or an older API (404): nothing to show.
      (e: unknown) => setState(e instanceof AuthApiError && [401, 403, 404].includes(e.status) ? { kind: 'none' } : { kind: 'failed' }),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.kind === 'none') return null;
  return (
    <section className="x2f-card" data-part="my-access" aria-labelledby="my-access-h">
      <h2 className="x2f-card__title" id="my-access-h">
        {C.title}
      </h2>
      {state.kind === 'loading' ? <p className="x2f-note">{C.loading}</p> : null}
      {state.kind === 'failed' ? (
        <>
          <p className="x2f-error" role="alert">
            {C.loadFailed}
          </p>
          <Button variant="secondary" onClick={load} data-part="my-access-retry">
            {C.retry}
          </Button>
        </>
      ) : null}
      {state.kind === 'ready' ? <AccessBody view={state.view} /> : null}
    </section>
  );
}

function AccessBody({ view }: { view: MyTeamAccess }) {
  const boxes = view.groups.flatMap((g) => g.boxes);
  const seesLog = boxes.some((b) => b.id === 'team-see-log');
  const l = view.limits;
  return (
    <>
      <p className="x2f-note">{C.intro}</p>
      <p className="x2f-note" data-part="my-access-lead">
        {C.lead(view.lead.displayName)}
      </p>
      <p className="x2f-note" data-part="my-access-name">
        {C.you(view.name)}
      </p>
      <p className="x2f-note" data-part="my-access-chat">
        {C.chatLabel(view.chatLabel)}
      </p>

      <h3 className="x2f-card__title" id="my-access-boxes-h">
        {C.boxesTitle}
      </h3>
      {boxes.length === 0 ? <p className="x2f-note">{C.noBoxes}</p> : null}
      {view.groups.map((g) => (
        <div key={g.id} data-group={g.id}>
          <p className="x2f-list__label">{g.label}</p>
          <ul className="x2f-list" data-part="my-access-boxes" aria-labelledby="my-access-boxes-h">
            {g.boxes.map((b) => (
              <li className="x2f-list__row" key={b.id} data-box={b.id}>
                <span className="x2f-list__label">
                  <span>{b.label}</span>
                  <br />
                  <span className="x2f-list__time">{b.does}</span>
                  {b.always ? (
                    <>
                      <br />
                      <span className="x2f-list__time">{C.always}</span>
                    </>
                  ) : null}
                  {!b.ready ? (
                    <>
                      <br />
                      <span className="x2f-list__time" data-part="my-access-not-ready">
                        {C.notReady}
                      </span>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {l !== undefined ? (
        <>
          <h3 className="x2f-card__title">{C.bandTitle}</h3>
          <p className="x2f-note" data-part="my-access-band">
            {bandText(l.band)}
          </p>
          <h3 className="x2f-card__title">{C.hoursTitle}</h3>
          <p className="x2f-note" data-part="my-access-hours">
            {hoursText(l.hours)}
          </p>
          <p className="x2f-note" data-part="my-access-now" data-inside={l.insideNow ? 'yes' : 'no'}>
            {!l.insideNow ? C.outside : l.workingUntil === null ? C.anyTime : (
              <>
                {C.insideUntil} <When at={l.workingUntil} />.
              </>
            )}
          </p>
        </>
      ) : null}

      {/* Team audit v2: a member with "See the team log" opens their own entries. */}
      {seesLog ? (
        <Link className="x2f-link" to={TEAM_LOG_PATH} data-part="my-team-log-link">
          {TEAM_LOG_COPY.title}
        </Link>
      ) : null}
    </>
  );
}
