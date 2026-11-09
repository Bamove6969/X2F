// The only place the trader app draws the violet "X2F Moderator" tag (spec 6.6; the kit's RoleTag, kit handoff 2.2): inside a
// disputed trade's screens, for a message or ruling that came from the moderator, and only when
// the server's records name a moderator on this dispute. A trader's own text that says "X2F
// Moderator" stays plain text. apps/web/test/moderator-badge-scope.test.ts keeps the moderator tag
// out of every other screen.
import { RoleTag } from '../../ui/Avatar.js';

export function ModeratorTag({ from, inDispute, moderator }: { from: 'buyer' | 'seller' | 'mod' | 'system'; inDispute: boolean; moderator: string | null }) {
  if (from !== 'mod' || !inDispute || moderator === null || moderator === '') return null;
  return <RoleTag role="mod" />;
}
