// The only place the trader app draws the violet "X2F Moderator" badge (spec 6.6): inside a
// disputed trade's screens, for a message or ruling that came from the moderator, and only when
// the server's records name a moderator on this dispute. A trader's own text that says "X2F
// Moderator" stays plain text. apps/web/test/moderator-badge-scope.test.ts keeps ModeratorBadge out
// of every other screen.
import { ModeratorBadge } from '../../ui/ModeratorBadge.js';

export function ModeratorTag({ from, inDispute, moderator }: { from: 'buyer' | 'seller' | 'mod' | 'system'; inDispute: boolean; moderator: string | null }) {
  if (from !== 'mod' || !inDispute || moderator === null || moderator === '') return null;
  return <ModeratorBadge />;
}
