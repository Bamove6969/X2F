/**
 * A team member's own access, read only (`GET /v1/team/me`): the boxes they hold in the catalogue's
 * words (team/abilities.ts), their trade-size band and working hours (team/limits.ts), whether they
 * are inside those hours now, and who their team lead is. Nothing here is another member's, and
 * nothing here can be changed by the member (the lead sets it all on the Team screen).
 */
import type { Queryable } from '../db/pool.js';
import { ABILITY_GROUPS, abilityOf, effectiveAbilities, presetOf, sortAbilities, type AbilityGroupId, type PresetId } from './abilities.js';
import { assistantLabel } from './label.js';
import { insideHours, ownLimitsView, workingUntil, type MemberLimitsView } from './limits.js';

/** One box a member holds, as the catalogue words it. */
export interface MyBox {
  id: string;
  /** COPY-UNSIGNED (the catalogue's label and description). */
  label: string;
  does: string;
  /** Always on for every member (their own login methods and the like): not the lead's choice. */
  always: boolean;
  /** False when the box is ticked but X2F does not offer what it allows yet (not built, or waiting on member keys). */
  ready: boolean;
}

export interface MyBoxGroup {
  id: AbilityGroupId;
  label: string;
  boxes: MyBox[];
}

export interface MyAccessView {
  /** The member's name inside the team. */
  name: string;
  /** How trade chats show the member (S-105). */
  chatLabel: string;
  /** The team lead: the account owner the member works for, by their Trade Tag. */
  lead: { tradeTag: string };
  /** The preset the lead's ticked boxes match exactly, or null (a custom set). */
  preset: PresetId | null;
  /** The boxes the member holds (the lead's and the always-on ones), by catalogue group, in catalogue order; empty groups left out. */
  groups: MyBoxGroup[];
  /**
   * The band and hours (as `GET /v1/account/me`'s `member.limits`), whether `serverNow` is inside the
   * hours, and when the current window ends (null: any time). Absent when MEMBER_SEES_OWN_LIMITS is off.
   */
  limits?: MemberLimitsView & { insideNow: boolean; workingUntil: string | null };
  serverNow: string;
}

/** The access view of live member `memberId` of team `accountId`; null when the row is gone. */
export async function myAccess(q: Queryable, accountId: string, memberId: string, now: Date): Promise<MyAccessView | null> {
  const { rows } = await q.query<{ trade_tag: string; abilities: string[]; assistant_no: number | null; lead_name: string; hours: unknown }>(
    `select tm.trade_tag, tm.abilities, tm.assistant_no, a.trade_tag as lead_name, tm.hours
       from team_members tm join accounts a on a.id = tm.account_id
      where tm.id = $1 and tm.account_id = $2 and tm.removed_at is null and tm.joined_at is not null`,
    [memberId, accountId],
  );
  const r = rows[0];
  if (!r || r.assistant_no === null) return null;
  const held = sortAbilities([...effectiveAbilities(r.abilities)]);
  const groups: MyBoxGroup[] = [];
  for (const g of ABILITY_GROUPS) {
    const boxes: MyBox[] = [];
    for (const id of held) {
      const a = abilityOf(id);
      if (!a || a.group !== g.id) continue;
      boxes.push({ id, label: a.label, does: a.does, always: a.availability === 'always', ready: a.availability === 'grantable' || a.availability === 'always' });
    }
    if (boxes.length > 0) groups.push({ id: g.id, label: g.label, boxes });
  }
  const view: MyAccessView = {
    name: r.trade_tag,
    chatLabel: assistantLabel(r.lead_name, r.assistant_no),
    lead: { tradeTag: r.lead_name },
    preset: presetOf(sortAbilities(r.abilities)),
    groups,
    serverNow: now.toISOString(),
  };
  const limits = await ownLimitsView(q, memberId);
  if (limits !== undefined) {
    const until = workingUntil(r.hours, now);
    view.limits = { ...limits, insideNow: insideHours(r.hours, now), workingUntil: until?.toISOString() ?? null };
  }
  return view;
}
