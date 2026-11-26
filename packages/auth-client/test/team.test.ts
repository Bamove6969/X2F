import { describeAction } from '@x2f/accounts';
import { describe, expect, it, vi } from 'vitest';
import { createAuthApi, teamInviteAction, teamRemoveAction, teamRolesAction } from '../src/index.js';

// Plan 2 Task 18: the team-member calls and their confirm actions.

interface Sent {
  url: string;
  init: RequestInit;
}

function recorder(reply: () => Response = () => Response.json({ ok: true })) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), init: init ?? {} });
    return reply();
  });
  return { sent, fetch: fetch as unknown as typeof globalThis.fetch };
}

const bodyOf = (s: Sent): unknown => (typeof s.init.body === 'string' ? JSON.parse(s.init.body) : undefined);

describe('team confirm actions', () => {
  it('bind the name and the roles in the API order (offers, trades), whatever order they were picked in', () => {
    expect(teamInviteAction('Alice.K', ['trades', 'offers'])).toEqual({ kind: 'team-invite', name: 'Alice.K', roles: 'offers,trades' });
    expect(teamInviteAction('Alice.K', ['trades'])).toEqual({ kind: 'team-invite', name: 'Alice.K', roles: 'trades' });
    expect(teamRolesAction('m1', ['offers'])).toEqual({ kind: 'team-roles', memberId: 'm1', roles: 'offers' });
    expect(teamRemoveAction('m1')).toEqual({ kind: 'team-remove', memberId: 'm1' });
  });

  it('read in plain words on the confirm sheet', () => {
    expect(describeAction(teamInviteAction('Alice.K', ['offers', 'trades']))).toBe('invite Alice.K as a team member (Offers and Trades)');
    expect(describeAction(teamRolesAction('m1', ['trades']))).toBe("change a team member's roles to Trades");
    expect(describeAction(teamRemoveAction('m1'))).toBe('remove a team member');
  });
});

describe('team calls', () => {
  it('use the routes, verbs and bodies the API serves', async () => {
    const { sent, fetch } = recorder(() => new Response(null, { status: 204 }));
    const api = createAuthApi({ fetch });
    await api.getTeam();
    await api.inviteMember({ tradeTag: 'Aurora', roles: ['trades'], confirmToken: 't1' });
    await api.setMemberRoles('a b', { roles: ['offers'], confirmToken: 't2' });
    await api.removeMember('id1', { confirmToken: 't3' });
    await api.teamAudit();
    await api.teamAudit({ member: 'id1', from: '2026-10-01T00:00:00.000Z' });
    await api.readInvite({ invite: 'code' });
    await api.joinStart({ invite: 'code', loginName: 'aurora1', publicKey: 'KEY', acceptedTerms: '2026-10-17' });
    await api.joinFinish({ challengeId: 'c', code: '123', termsSignature: { kind: 'typed', name: 'A' } });
    await api.joinSecondPgpStart({ setupId: 's', publicKey: 'KEY2' });
    await api.joinSecondPgpFinish({ setupId: 's', challengeId: 'c2', code: '456', deviceLabel: 'Phone' });
    await api.joinSecondWebAuthnStart({ setupId: 's', kind: 'security-key' });
    expect(sent.map((s) => `${s.init.method} ${s.url}`)).toEqual([
      'GET /v1/team',
      'POST /v1/team/invites',
      'PATCH /v1/team/members/a%20b',
      'DELETE /v1/team/members/id1',
      'GET /v1/team/audit',
      'GET /v1/team/audit?from=2026-10-01T00%3A00%3A00.000Z&member=id1',
      'POST /v1/team/invite',
      'POST /v1/team/join/start',
      'POST /v1/team/join/finish',
      'POST /v1/team/join/second/pgp/start',
      'POST /v1/team/join/second/pgp/finish',
      'POST /v1/team/join/second/webauthn/start',
    ]);
    expect(bodyOf(sent[1]!)).toEqual({ tradeTag: 'Aurora', roles: ['trades'], confirmToken: 't1' });
    expect(bodyOf(sent[2]!)).toEqual({ roles: ['offers'], confirmToken: 't2' });
    // The confirm token goes in the body, never the URL (R17).
    expect(bodyOf(sent[3]!)).toEqual({ confirmToken: 't3' });
    // Owner 9 Nov 2026 (p11-14): the member's signature goes with the join finish.
    expect(bodyOf(sent[8]!)).toEqual({ challengeId: 'c', code: '123', termsSignature: { kind: 'typed', name: 'A' } });
  });
});

describe('team refusals', () => {
  it('too-many-members carries the limit', async () => {
    const { fetch } = recorder(() => Response.json({ error: 'too-many-members', max: 3 }, { status: 409 }));
    const e = await createAuthApi({ fetch }).inviteMember({ tradeTag: 'Aurora', roles: ['offers'] }).catch((x: unknown) => x);
    expect(e).toMatchObject({ status: 409, code: 'too-many-members', max: 3 });
  });
});
