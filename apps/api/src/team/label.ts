/**
 * Owner p11-25 (S-105, 9 Nov 2026, replacing R44's "Message from Team <name> member: <member>"):
 * how a trade chat labels a team member's message. "I think it'll be based on the display name of
 * the main agent. So if the main agent is Circa 55, it'll be Circa 55 Assistant 1 or Circa 55
 * Assistant 2." The member's own name is never part of it (it stays inside the team: the lead's
 * list, the activity log, notes).
 *
 * `n` is the member's `team_members.assistant_no` (migration 390: the lowest number no live member
 * of the team holds). The words are the owner's; the chat itself shows them once a member may chat
 * (C-019, the member chat key path; abilities `waits-member-chat-key`).
 */
export function assistantLabel(leadDisplayName: string, n: number): string {
  return `${leadDisplayName} Assistant ${n}`;
}
