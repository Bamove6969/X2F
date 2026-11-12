import { GRANTABLE_PERMS, can, type GrantablePerm } from '@x2f/staff';
import { useEffect, useState } from 'react';
import { members as fetchMembers, setGrants, type Member } from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { CantDoThat, Button, Notice } from '../ui/kit.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { ROLE_LABELS } from '../ui/RoleChip.js';
import { PageTitle } from '../ui/StaffShell.js';
import '../ui/staff.css';

// DESIGN: not drawn. The role checkboxes have no board yet (J-21; design draws them on StaffList):
// plain kit pieces until then. Plan 4 Task 17 builds the rest of StaffList (invites, hours, switch
// off) around them. Every sentence on this page is draft copy. COPY-UNSIGNED

/** Each per-person checkbox (GRANTABLE_PERMS, owner Q60 and Plan 4 Task 30), as the page words it. */
export const GRANT_LABELS: Readonly<Record<GrantablePerm, { title: string; help: string }>> = {
  'feedback.read': { title: 'Feedback', help: "Reads traders' feedback. Never who sent a named message." },
  'tickets.handle': { title: 'Support tickets', help: "Answers traders' support tickets." },
};

/** Shown beside a box the role always holds (a senior moderator's Feedback, owner Q60). */
export const ROLE_HOLDS: Readonly<Partial<Record<GrantablePerm, string>>> = {
  'feedback.read': 'Senior moderators always have Feedback.',
};

const sorted = (g: readonly GrantablePerm[]) => [...new Set(g)].sort() as GrantablePerm[];
const same = (a: readonly GrantablePerm[], b: readonly GrantablePerm[]) => sorted(a).join() === sorted(b).join();

/**
 * The owner's Staff page, for now the per-person checkboxes only (owner Q60, 6 Nov: moderators'
 * and helpers' permissions are granular; a senior moderator always has Feedback). One row per staff
 * member who is not the owner (invites get their boxes once they join). A box the role already
 * holds is ticked and fixed. "Save" opens the key tap bound to the person and the exact sorted list
 * (`set-grants`), and only then `PUT /staff/v1/members/:id/grants` stores it; the API checks both
 * the tap and the list (apps/api/src/staff/members.ts), so the page decides nothing.
 */
export function StaffGrants() {
  const [list, setList] = useState<Member[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMembers().then(
      (r) => {
        if (live) setList(r.members.filter((m) => m.accountId !== null && m.role !== 'owner'));
      },
      (e: unknown) => {
        if (live) setFault(faultText(e, 'X2F could not load the staff list just now. Reload to try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section data-screen="staff">
      <PageTitle title="Staff">
        <p className="x2f-staff-page__lead">Tick what each person may do on top of their role. Each change needs a tap of your security key.</p>
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {list !== null && list.length === 0 ? <p>No staff yet.</p> : null}
      {list?.map((m) => <MemberGrants key={m.accountId} member={m} />)}
    </section>
  );
}

function MemberGrants({ member }: { member: Member }) {
  const id = member.accountId!;
  const [stored, setStored] = useState<GrantablePerm[]>(sorted(member.grants));
  const [draft, setDraft] = useState<GrantablePerm[]>(sorted(member.grants));
  const [tapping, setTapping] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const name = member.displayName ?? '';

  const toggle = (p: GrantablePerm, on: boolean) => {
    setSaved(false);
    setDraft((d) => sorted(on ? [...d, p] : d.filter((x) => x !== p)));
  };

  const save = async (tapId: string) => {
    setTapping(false);
    try {
      const r = await setGrants(id, draft, tapId);
      setStored(sorted(r.grants));
      setDraft(sorted(r.grants));
      setSaved(true);
      setFault(null);
    } catch (e) {
      setDraft(stored);
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      else setFault(faultText(e, 'The change was not saved. Try again.'));
    }
  };

  return (
    <fieldset className="x2f-card x2f-stack" data-member={id}>
      <legend>
        <span data-username>{name}</span>
        {` · ${ROLE_LABELS[member.role]}`}
        {member.status === 'switched-off' ? ' · Switched off' : null}
      </legend>
      {GRANTABLE_PERMS.map((p) => {
        const byRole = can(member.role, p);
        const holds = ROLE_HOLDS[p];
        return (
          <label key={p} className="x2f-check">
            <input
              type="checkbox"
              data-perm={p}
              checked={byRole || draft.includes(p)}
              disabled={byRole || tapping}
              onChange={(e) => toggle(p, e.target.checked)}
            />
            <span>
              <strong>{GRANT_LABELS[p].title}</strong> {GRANT_LABELS[p].help}
              {byRole && holds !== undefined ? ` ${holds}` : null}
            </span>
          </label>
        );
      })}
      {fault !== null ? (
        <Notice tone="danger" data-part="grants-fault">
          {fault}
        </Notice>
      ) : null}
      {saved ? (
        <Notice tone="plain" data-part="grants-saved">
          Saved.
        </Notice>
      ) : null}
      <Button variant="secondary" disabled={same(draft, stored) || tapping} onClick={() => setTapping(true)}>
        Save
      </Button>
      {tapping ? (
        <KeyTapDialog
          intent={{ kind: 'set-grants', accountId: id, grants: draft }}
          title={`Change what ${name} may do`}
          body="Tap your security key to save this change."
          onDone={(tapId) => void save(tapId)}
          onCancel={() => setTapping(false)}
        />
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </fieldset>
  );
}
